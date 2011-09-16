
/**
  Valid file extensions opal can load/run
*/
var load_extensions = {};

load_extensions['.js'] = function(loader, path) {
  var source = loader.file_contents(path);
  return load_execute_file(loader, source, path);
};

load_extensions['.rb'] = function(loader, path) {
  var source = loader.ruby_file_contents(path);
  return load_execute_file(loader, source, path);
};

/**
  Require a file by its given lib path/id, or a full path.

  @param {String} id lib path/name
  @return {Boolean}
*/
var rb_require = Op.require = function(lib) {
  var resolved = Op.loader.resolve_lib(lib);
  var cached = Op.cache[resolved];

  // If we have a cache for this require then it has already been
  // required. We return false to indicate this.
  if (cached) return false;

  Op.cache[resolved] = true;

  // try/catch wrap entire file load?
  load_file(Op.loader, resolved);

  return true;
};

/**
  Sets the primary 'gem', by name, so we know which cwd to use etc.
  This can be changed at anytime, but it is only really recomended
  before the application is run.

  Also, if a gem with the given name cannot be found, then an error
  will/should be thrown.

  @param {String} name The root gem name to use
*/
Op.primary = function(name) {
  Fs.cwd = '/' + name;
};

/**
  Just go ahead and run the given block of code. The passed function
  should rake the usual runtime, self and file variables which it will
  be passed.

  @param {Function} body
*/
Op.run = function(body) {
  var res = Qnil;

  if (typeof body != 'function') {
    rb_raise(rb_eException, "Expected body to be a function");
  }

  // try {
    res = body(Rt, rb_top_self, "(opal)");
  // }
  // catch (err) {
    // var stack;

    // if (err.$message) {
      // puts(err.$k.__classid__ + ': ' + err.$message);
    // }
    // else if (err.message) {
      // puts(err.$k.__classid__ + ': ' + err.message);
    // }
    // else {
      // puts('NativeError: ' + err.message);
      // console.log(err);
    // }
  // }
  return res;
};

/**
  Register a simple lib file. This file is simply just put into the lib
  "directory" so it is ready to load"

  @param {String} name The lib/gem name
  @param {String, Function} info
*/
Op.lib = function(name, info) {
  // make sure name if useful
  if (typeof name !== 'string') {
    rb_raise(rb_eException, "Cannot register a lib without a proper name");
  }

  // make sure info is useful
  if (typeof info === 'string' || typeof info === 'function') {
    return load_register_lib(name, info);
  }

  // something went wrong..
  rb_raise(rb_eException, "Invalid lib data for: " + name);
};

/**
  External api for defining a gem. This takes an object that defines
  all the gem info and files.

  @param {Object} info Gem info
*/
Op.gem = function(info) {
  if (typeof info === 'object') {
    load_register_gem(info);
  }
  else {
    rb_raise(rb_eException, "Invalid gem data");
  }
};

/**
  Actually register a predefined gem. This is for the browser context
  where gems can be serialized into JSON and defined before hand.

  @param {Object} info Serialized gemspec
*/
function load_register_gem(info) {
  var factories = Op.loader.factories,
      paths     = Op.loader.paths,
      name      = info.name;

  // register all lib files
  var libs = info.libs || {};

  // root dir for gem is '/gem_name'
  var root_dir = '/' + name;

  // for now assume './lib' as dir for all libs (should be dynamic..)
  var lib_dir = '/' + name + '/lib/';

  // add lib dir to paths
  paths.unshift(fs_expand_path(fs_join(root_dir, lib_dir)));

  for (var lib in libs) {
    if (hasOwnProperty.call(libs, lib)) {
      var file_path = lib_dir + lib + '.rb';
      Op.loader.factories[file_path] = libs[lib];
      Op.loader.libs[lib] = file_path;
    }
  }

  // register other info? (version etc??)
}

/**
  Register a single lib/file in browser before its needed. These libs
  are added to top level dir '/lib_name.rb'

  @param {String} name Lib name
  @param {Function, String} factory
*/
function load_register_lib(name, factory) {
  var path = '/lib/' + name;
  Op.loader.factories[path] = factory;
  Op.loader.libs[name] = path;
}

/**
  The loader is the core machinery used for loading and executing libs
  within opal. An instance of opal will have a `.loader` property which
  is an instance of this Loader class. A Loader is responsible for
  finding, opening and reading contents of libs on disk. Within the
  browser a loader may use XHR requests or cached libs defined by JSON
  to load required libs/gems.

  @constructor
  @param {opal} opal Opal instance to use
*/
function Loader(opal) {
  this.opal = opal;
  this.paths = ['', '/lib'];
  this.factories = {};
  this.libs = {};
  return this;
}

// For minimizing
var Lp = Loader.prototype;

/**
  The paths property is an array of disk paths in which to search for
  required modules. In the browser this functionality isn't really used.

  This array is created within the constructor method for uniqueness
  between instances for correct sandboxing.
*/
Lp.paths = null;

/**
  factories of registered packages, paths => function/string. This is
  generic, but in reality only the browser uses this, and it is treated
  as the mini filesystem. Not just factories can go here, anything can!
  Images, text, json, whatever.
*/
Lp.factories = {};

/**
  Resolves the path to the lib, which can then be used to load. This
  will throw an error if the module cannot be found. If this method
  returns a successful path, then subsequent methods can assume that
  the path exists.

  @param {String} lib The lib name/path to look for
  @return {String}
*/
Lp.resolve_lib = function(lib) {
  var resolved = this.find_lib(lib, this.paths);

  if (!resolved) {
    raise(eLoadError, "no such file to load -- " + lib);
  }

  return resolved;
};

Lp.find_lib = function(id) {
  var libs = this.libs;
  var id_with_ext = id + '.rb';

  // try to load a lib path first - i.e. something in our load path
  if (libs[id_with_ext]) {
    return libs[id_with_ext];
  }

  // go through full paths..

  // next, incase our require() has a ruby extension..
  if (id.lastIndexOf('.rb') == id.length - 3) {
    // id = id.substr(0, id.length - 3);
    if (libs[id]) {
      return libs[id];
    }
    // if not..
    // return null;
  }

  return null;
};

/**
  Valid factory format for use in require();
*/
Lp.valid_extensions = ['.js', '.rb'];

/**
  Get lib contents for js files
*/
Lp.file_contents = function(path) {
  return this.factories[path];
};

Lp.ruby_file_contents = function(path) {
  return this.factories[path];
};

/**
  Actually run file with resolved name.

  @param {Loader} loader
  @param {String} path
*/
function load_file(loader, path) {
  var ext = load_extensions[PATH_RE.exec(path)[3] || '.js'];

  if (!ext) {
    rb_raise(rb_eException, "load_run_file - Bad extension for resolved path");
  }

  ext(loader, path);
}

/**
  Run content which must now be javascript. Arguments we pass to func
  are:

    $rb
    top_self
    filename

  @param {String, Function} content
  @param {String} path
*/
function load_execute_file(loader, content, path) {
  var args = [Rt, rb_top_self, path];

  if (typeof content === 'function') {
    return content.apply(Op, args);

  } else if (typeof content === 'string') {
    var func = loader.wrap(content, path);
    return func.apply(Op, args);

  } else {
    rb_raise(rb_eException, "Loader.execute - bad content for: " + path);
  }
}

/**
  Getter method for getting the load path for opal.

  @param {String} id The globals id being retrieved.
  @return {Array} Load paths
*/
function rb_load_path_getter(id) {
  return Op.loader.paths;
}

/**
  Getter method to get all loaded features.

  @param {String} id Feature global id
  @return {Array} Loaded features
*/
function rb_loaded_feature_getter(id) {
  return loaded_features;
}
