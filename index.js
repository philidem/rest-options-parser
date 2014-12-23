//var AppError = require('./AppError');

var parallel = require('raptor-async/parallel');
var extend = require('raptor-util/extend');

var _types = require('./types');

function Options() {
	
}

Options.prototype._isOption = true;

Options.prototype.addJob = function(job) {
	(this._work || (this._work = [])).push(job);
};

Options.prototype.addError = function(message, option, options) {
	var errors = this.errors || (this.errors = []);
	errors.push({
		option: option,
		message: message
	});
};

var Source = {
	// Use this type if the value comes from the request body
	BODY: function(option, options, rest) {
		options.addJob(function(callback) {
			rest.getParsedBody(function(err, value) {
				if (err) {
					options.addError('Invalid request body', option, options);
				} else {
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
	
	return source;
}

function _parseType(option) {
	var type = option.type;
	if (type) {
		if (_isArrayType(type)) {
			type = type.substring(0, type.length - 2);
			option.array = true;
		}
		
		if (type.length > 0) {
			option.coerce = _types[type.toUpperCase()];
			if (!option.coerce) {
				throw new Error('Invalid option type: ' + type);
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

function _validationError(errors) {
    var message = errors.map(function(error) {
        var message = error.option.name + ': ';
        
        message += error.message;
        return message;
    }).join('. ');
    
    var err = new Error(message);
    err.source = exports;
    return err;
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

exports.validateOptions = function(options, route, callback) {
	var declaredOptions = route._options;
	if (!declaredOptions) {
		return true;
	}
	
	if (!options._isOption) {
		extend(options, Options.prototype);
	}
	
	var i = declaredOptions.length;
	while(--i >= 0) {
		var option = declaredOptions[i];
		var value = options[option.property];
		_validateValueForOption(value, option, options);
	}
	
	if (options.errors) {
		var err = _validationError(options.errors);
		callback(err);
		return false;
	}
	
	return true;
};

// The before function will be invoked to handle each request
exports.before = function(rest) {
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
	
	var work = options._work;
	if (work === undefined) {
		rest.next();
	} else {
		parallel(work, function(err) {
			delete options._work;
			
			if (err) {
				return rest.error(err);
			}
			
			if (options.errors) {
				rest.error(_validationError(options.errors));
			} else {
				rest.next();
			}
		});
	}
};

// The middleware will add hooks to initialize routes that have
// options property
exports.middleware = {
	init: function(restHandler) {
		function initializeRoute(route) {
			if (route.options) {
				exports.initializeRoute(route);
			}
		}
		
		// initialize existing routes
		restHandler.getAllRoutes().forEach(initializeRoute);
		
		// initialize routes that are added later
		restHandler.on('route', function(event) {
			initializeRoute(event.route);
		});
	}
};

exports.registerTypes = function(types) {
	extend(_types, types);
	for (var typeName in types) {
		if (types.hasOwnProperty(typeName)) {
			_types[typeName.toUpperCase()] = types[typeName];
		}
	}
};

exports.initializeRoute = function(route) {
	if (route._options !== undefined) {
		return;
	}
	
	var declaredOptionsByName = route.options;
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
	}
	
	route.addBefore(exports.before);
};
