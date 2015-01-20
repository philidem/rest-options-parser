//var AppError = require('./AppError');

var parallel = require('raptor-async/parallel');
var extend = require('raptor-util/extend');

var _types = require('./types');
var _typeResolvers = [];

var optionsParser = exports;

function _validationError(errors) {
    var message = errors.map(function(error) {
        var message = error.option.name + ': ';
        
        message += error.message;
        return message;
    }).join('. ');
	
    var err = new Error(message);
    err.source = optionsParser;
    return err;
}

function Options() {
	
}

Options.prototype._isOption = true;

Options.prototype.addJob = function(job) {
	(this._work || (this._work = [])).push(job);
};

Options.prototype.hasWork = function() {
	return (this._work !== undefined);
};

Options.prototype.addError = function(message, option, options) {
	var errors = this.errors || (this.errors = []);
	errors.push({
		option: option,
		message: message
	});
};

function _doWorkForOptions(options, callback) {
	var work = options._work;
	if (!work) {
		return callback();
	}
	
	parallel(work, function(err) {
		// clear out the work
		delete options._work;
		
		if (err) {
			return callback(err);
		}
		
		if (options.errors) {
			return callback(_validationError(options.errors));
		} else {
			callback();
		}
	});
}

var Source = {
	// Use this type if the value comes from the request body
	BODY: function(option, options, rest) {
		options.addJob(function(callback) {
			rest.getBody(function(err, value) {
				if (err) {
					options.addError('Error reading request body', option, options);
				} else {
					value = value.trim();
					if (value.length > 0) {
						try {
							value = JSON.parse(value);
						} catch(e) {
							if (e) {
								options.addError('Invalid JSON. ' + e, option, options);
							}
							return callback();
						}
					} else {
						value = undefined;
					}
					_validateValueForOption(value, option, options);
				}
				callback();
			});
		});
	},
	
	// Use this type if the value comes from the request URL query string
	QUERY: function(option, options, rest) {
		var value = rest.url.query ? rest.url.query[option.name] : undefined;
		_validateValueForOption(value, option, options);
	},
	
	// Use this type if value comes from the request path
	PARAMS: function(option, options, rest) {
		var value = rest.params ? rest.params[option.name] : undefined;
		_validateValueForOption(value, option, options);
	},
	
	// Use this type if value came from other middleware
	REST: function(option, options, rest) {
		var value = rest[option.name];
		_validateValueForOption(value, option, options);
	},
	
	// Use this type if value came from other middleware
	OPTIONS: function(option, options, rest) {
		var value = options[option.name];
		_validateValueForOption(value, option, options);
	},
	
	// Use this type if value came from other middleware
	HEADER: function(option, options, rest) {
		var value = rest.req.headers[option.header];
		_validateValueForOption(value, option, options);
	}
};

function _parseSource(option) {
	var sourceName = option.source;
	if (sourceName == null) {
		// params is the default source
		return Source.PARAMS;
	}
	
	sourceName = sourceName.toUpperCase();
	var source = Source[sourceName];
	if (source === undefined) {
		throw new Error('Invalid option source: ' + sourceName);
	}
	
	if (source === Source.HEADER) {
		option.header = (option.header || option.name).toLowerCase();
	}
	
	return source;
}

function _resolveType(name) {
	var coerce;
	for (var i = 0; i < _typeResolvers.length; i++) {
		coerce = _typeResolvers[i](name);
		if (coerce != null) {
			return coerce;
		}
	}
	return null;
}

function _parseType(option) {
	var type = option.type;
	if (type) {
		if (_isArrayType(type)) {
			type = type.substring(0, type.length - 2);
			option.array = true;
		}
		
		if (type.length > 0) {
			var normalizedName = type.toUpperCase();
			option.coerce = _types[normalizedName];
			if (!option.coerce) {
				option.coerce = _resolveType(type);
				
				if (!option.coerce) {
					throw new Error('Invalid option type: ' + type);
				}
				
				// we resolved the type
				_types[normalizedName] = option.coerce;
			}
		} else {
			type = undefined;
		}
	}
	
	return type;
}

function _isArrayType(type) {
	var typeLen = type.length;
	return ((type.charAt(typeLen - 2) === '[') && (type.charAt(typeLen - 1) === ']'));
}

function _makeArray(value) {
	if (Array.isArray(value)) {
		return value;
	} else {
		return [value];
	}
}

function _validateValueForOption(value, option, options) {
	if (value === undefined) {
		if (option.default !== undefined) {
			// handle default
			options[option.property] = option.default;
		} else if (option.required) {
			options.addError('Required', option, options);
		}
	} else {
		var coerce = option.coerce;
		
		if (coerce) {
			if (option.array) {
				value = _makeArray(value);
				var j = value.length;
				
				if (j === 0 && option.required) {
					options.addError('Required', option, options);
					return;
				}
				
				while(--j >= 0) {
					value[j] = coerce(value[j], option, options);
				}
			} else {
				value = coerce(value, option, options);
			}
		} else {
			// no type coercion
			if (option.array) {
				value = _makeArray(value);
				if (value.length === 0 && option.required) {
					options.addError('Required', option, options);
				}
			}
		}
		
		options[option.property] = value;
	}
}

optionsParser.addTypeResolver = function(typeResolver) {
	_typeResolvers.push(typeResolver);
};

optionsParser.validateOptions = function(options, route, callback) {
	var declaredOptions = route._options;
	if (!declaredOptions) {
		return callback();
	}
	
	if (!options._isOption) {
		// Add mixins from Options to make the given object compatible with Options
		extend(options, Options.prototype);
	}
	
	var i = declaredOptions.length;
	while(--i >= 0) {
		var option = declaredOptions[i];
		var value = options[option.property];
		_validateValueForOption(value, option, options);
	}
	
	if (options.errors) {
		return callback(_validationError(options.errors));
	}
	
	_doWorkForOptions(options, callback);
};

// The before function will be invoked to handle each request
optionsParser.before = function(rest) {
	var declaredOptions = rest.route._options;
	if (!declaredOptions) {
		// if the route doesn't have any declared options then nothing to do
		return rest.next();
	}
	
	var options = rest.options = new Options();
	var i = declaredOptions.length;
	while(--i >= 0) {
		var option = declaredOptions[i];
		var source = option.source;
		source(option, options, rest);
	}
	
	if (options.errors) {
		return rest.error(_validationError(options.errors));
	}
	
	_doWorkForOptions(options, function(err) {
		if (err) {
			rest.error(err);
		} else {
			rest.next();
		}
	});
};

// The middleware will add hooks to initialize routes that have
// options property
optionsParser.middleware = {
	init: function(restHandler) {
		// initialize existing routes
		restHandler.getAllRoutes().forEach(function initializeRoute(route) {
			optionsParser.initializeRoute(route);
		});
		
		// initialize routes that are added later
		restHandler.on('route', function(event) {
			optionsParser.initializeRoute(event.route);
		});
	}
};

optionsParser.registerTypes = function(types) {
	extend(_types, types);
	for (var typeName in types) {
		if (types.hasOwnProperty(typeName)) {
			_types[typeName.toUpperCase()] = types[typeName];
		}
	}
};

optionsParser.initializeRoute = function(route) {
	if (route._options) {
		// this route already has options that have been initialized
		return;
	}
	
	var declaredOptionsByName = route.options;
	if (!declaredOptionsByName) {
		// nothing to do if this route does not have options
		return;
	}
	
	var optionNames;
	
	route.getPlaceholders().forEach(function(optionName) {
		// add implicit options from the URL parameters defined in the route
		if (declaredOptionsByName && !declaredOptionsByName[optionName]) {
			if (!declaredOptionsByName) {
				declaredOptionsByName = {};
			}
			
			declaredOptionsByName[optionName] = {};
		}
	});
	
	if (!declaredOptionsByName || ((optionNames = Object.keys(declaredOptionsByName)).length === 0)) {
		// no options...
		route._options = null;
		return;
	}
	
	var declaredOptions = route._options = [];
	
	for (var i = 0; i < optionNames.length; i++) {
		var optionName = optionNames[i];
		var option = declaredOptions[i] = extend({}, declaredOptionsByName[optionName]);
		
		option.name = optionName;
		option.property = option.property || optionName;
		option.type = _parseType(option);
		option.source = _parseSource(option);
        
        if (option.source === Source.PARAMS) {
            if (option.required === undefined) {
                option.required = true;
            }
        }
	}
	
	route.addBefore(optionsParser.before);
};
