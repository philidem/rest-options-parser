module.exports = {
	BOOLEAN: function(value, option, options) {
		if (value == null) {
			return value;
		}
		
		if (value.constructor === String) {
			value = (value.length === 0) ? null : (value === 'true');
		} else {
			value = (value === true);
		}
		return value;
	},
	
	STRING: function(value, option, options) {
		if (value == null) {
			return value;
		}
		value = value.toString();
		
		if (value.length === 0) {
			if (option.emptyNull) {
				return null;
			}
		} else {
			if (option.forceLowerCase) {
				value = value.toLowerCase();
			} else if (option.forceUpperCase) {
				value = value.toUpperCase();
			}
		}
		
		return value;
	},
	
	NUMBER: function(value, option, options) {
		if (value == null) {
			return value;
		}
		
		if (value.constructor === String) {
			return Number(value);
		} else if (value.constructor !== Number) {
			options.addError('Invalid number: ' + value, option, options);
		} else {
			return value;
		}
	}
};
