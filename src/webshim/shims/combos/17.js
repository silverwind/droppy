jQuery.webshims.register('form-number-date-api', function($, webshims, window, document, undefined, options){
	"use strict";
	if(!webshims.addInputType){
		webshims.error("you can not call forms-ext feature after calling forms feature. call both at once instead: $.webshims.polyfill('forms forms-ext')");
	}
	
	if(!webshims.getStep){
		webshims.getStep = function(elem, type){
			var step = $.attr(elem, 'step');
			if(step === 'any'){
				return step;
			}
			type = type || getType(elem);
			if(!typeModels[type] || !typeModels[type].step){
				return step;
			}
			step = typeProtos.number.asNumber(step);
			return ((!isNaN(step) && step > 0) ? step : typeModels[type].step) * (typeModels[type].stepScaleFactor || 1);
		};
	}
	if(!webshims.addMinMaxNumberToCache){
		webshims.addMinMaxNumberToCache = function(attr, elem, cache){
			if (!(attr+'AsNumber' in cache)) {
				cache[attr+'AsNumber'] = typeModels[cache.type].asNumber(elem.attr(attr));
				if(isNaN(cache[attr+'AsNumber']) && (attr+'Default' in typeModels[cache.type])){
					cache[attr+'AsNumber'] = typeModels[cache.type][attr+'Default'];
				}
			}
		};
	}
	
	var nan = parseInt('NaN', 10),
		doc = document,
		typeModels = webshims.inputTypes,
		isNumber = function(string){
			return (typeof string == 'number' || (string && string == string * 1));
		},
		supportsType = function(type){
			return ($('<input type="'+type+'" />').prop('type') === type);
		},
		getType = function(elem){
			return (elem.getAttribute('type') || '').toLowerCase();
		},
		isDateTimePart = function(string){
			return (string && !(isNaN(string * 1)));
		},
		addMinMaxNumberToCache = webshims.addMinMaxNumberToCache,
		addleadingZero = function(val, len){
			val = ''+val;
			len = len - val.length;
			for(var i = 0; i < len; i++){
				val = '0'+val;
			}
			return val;
		},
		EPS = 1e-7,
		typeBugs = webshims.bugs.bustedValidity
	;
	
	webshims.addValidityRule('stepMismatch', function(input, val, cache, validityState){
		if(val === ''){return false;}
		if(!('type' in cache)){
			cache.type = getType(input[0]);
		}
		
		var ret = (validityState || {}).stepMismatch || false, base;
		if(typeModels[cache.type] && typeModels[cache.type].step){
			if( !('step' in cache) ){
				cache.step = webshims.getStep(input[0], cache.type);
			}
			
			if(cache.step == 'any'){return false;}
			
			if(!('valueAsNumber' in cache)){
				cache.valueAsNumber = typeModels[cache.type].asNumber( val );
			}
			if(isNaN(cache.valueAsNumber)){return false;}
			
			addMinMaxNumberToCache('min', input, cache);
			base = cache.minAsNumber;
			if(isNaN(base)){
				base = typeModels[cache.type].stepBase || 0;
			}
			
			ret =  Math.abs((cache.valueAsNumber - base) % cache.step);
							
			ret = !(  ret <= EPS || Math.abs(ret - cache.step) <= EPS  );
		}
		return ret;
	});
	
	
	
	[{name: 'rangeOverflow', attr: 'max', factor: 1}, {name: 'rangeUnderflow', attr: 'min', factor: -1}].forEach(function(data, i){
		webshims.addValidityRule(data.name, function(input, val, cache, validityState) {
			var ret = (validityState || {})[data.name] || false;
			if(val === ''){return ret;}
			if (!('type' in cache)) {
				cache.type = getType(input[0]);
			}
			if (typeModels[cache.type] && typeModels[cache.type].asNumber) {
				if(!('valueAsNumber' in cache)){
					cache.valueAsNumber = typeModels[cache.type].asNumber( val );
				}
				if(isNaN(cache.valueAsNumber)){
					return false;
				}
				
				addMinMaxNumberToCache(data.attr, input, cache);
				
				if(isNaN(cache[data.attr+'AsNumber'])){
					return ret;
				}
				ret = ( cache[data.attr+'AsNumber'] * data.factor <  cache.valueAsNumber * data.factor - EPS );
			}
			return ret;
		});
	});
	
	webshims.reflectProperties(['input'], ['max', 'min', 'step']);
	
	
	//IDLs and methods, that aren't part of constrain validation, but strongly tight to it
	var valueAsNumberDescriptor = webshims.defineNodeNameProperty('input', 'valueAsNumber', {
		prop: {
			get: function(){
				var elem = this;
				var type = getType(elem);
				var ret = (typeModels[type] && typeModels[type].asNumber) ? 
					typeModels[type].asNumber($.prop(elem, 'value')) :
					(valueAsNumberDescriptor.prop._supget && valueAsNumberDescriptor.prop._supget.apply(elem, arguments));
				if(ret == null){
					ret = nan;
				}
				return ret;
			},
			set: function(val){
				var elem = this;
				var type = getType(elem);
				if(typeModels[type] && typeModels[type].numberToString){
					//is NaN a number?
					if(isNaN(val)){
						$.prop(elem, 'value', '');
						return;
					}
					var set = typeModels[type].numberToString(val);
					if(set !==  false){
						$.prop(elem, 'value', set);
					} else {
						webshims.error('INVALID_STATE_ERR: DOM Exception 11');
					}
				} else {
					valueAsNumberDescriptor.prop._supset && valueAsNumberDescriptor.prop._supset.apply(elem, arguments);
				}
			}
		}
	});
	
	var valueAsDateDescriptor = webshims.defineNodeNameProperty('input', 'valueAsDate', {
		prop: {
			get: function(){
				var elem = this;
				var type = getType(elem);
				return (typeModels[type] && typeModels[type].asDate && !typeModels[type].noAsDate) ? 
					typeModels[type].asDate($.prop(elem, 'value')) :
					valueAsDateDescriptor.prop._supget && valueAsDateDescriptor.prop._supget.call(elem) || null;
			},
			set: function(value){
				var elem = this;
				var type = getType(elem);
				if(typeModels[type] && typeModels[type].dateToString && !typeModels[type].noAsDate){
					
					if(value === null){
						$.prop(elem, 'value', '');
						return '';
					}
					var set = typeModels[type].dateToString(value);
					if(set !== false){
						$.prop(elem, 'value', set);
						return set;
					} else {
						webshims.error('INVALID_STATE_ERR: DOM Exception 11');
					}
				} else {
					return valueAsDateDescriptor.prop._supset && valueAsDateDescriptor.prop._supset.apply(elem, arguments) || null;
				}
			}
		}
	});
	
	$.each({stepUp: 1, stepDown: -1}, function(name, stepFactor){
		var stepDescriptor = webshims.defineNodeNameProperty('input', name, {
			prop: {
				value: function(factor){
					var step, val, dateVal, valModStep, alignValue, cache;
					var type = getType(this);
					if(typeModels[type] && typeModels[type].asNumber){
						cache = {type: type};
						if(!factor){
							factor = 1;
							webshims.info("you should always use a factor for stepUp/stepDown");
						}
						factor *= stepFactor;
						
						val = $.prop(this, 'valueAsNumber');
						
						if(isNaN(val)){
							webshims.info("valueAsNumber is NaN can't apply stepUp/stepDown ");
							throw('invalid state error');
						}
						
						step = webshims.getStep(this, type);
						
						if(step == 'any'){
							webshims.info("step is 'any' can't apply stepUp/stepDown");
							throw('invalid state error');
						}
						
						webshims.addMinMaxNumberToCache('min', $(this), cache);
						webshims.addMinMaxNumberToCache('max', $(this), cache);
						
						step *= factor;
						
						val = (val + step).toFixed(5) * 1;
						valModStep = (val - (cache.minAsNumber || 0)) % step;
						
						if ( valModStep && (Math.abs(valModStep) > EPS) ) {
							alignValue = val - valModStep;
							alignValue += ( valModStep > 0 ) ? step : ( -step );
							val = alignValue.toFixed(5) * 1;
						}
						
						if( (!isNaN(cache.maxAsNumber) && val > cache.maxAsNumber) || (!isNaN(cache.minAsNumber) && val < cache.minAsNumber) ){
							webshims.info("max/min overflow can't apply stepUp/stepDown");
							throw('invalid state error');
						}
						if(dateVal){
							$.prop(this, 'valueAsDate', dateVal);
						} else {
							$.prop(this, 'valueAsNumber', val);
						}
					} else if(stepDescriptor.prop && stepDescriptor.prop.value){
						return stepDescriptor.prop.value.apply(this, arguments);
					} else {
						webshims.info("no step method for type: "+ type);
						throw('invalid state error');
					}
				}
			}
		});
	});
	
	
	var typeProtos = {
		
		number: {
			mismatch: function(val){
				return !(isNumber(val));
			},
			step: 1,
			//stepBase: 0, 0 = default
			stepScaleFactor: 1,
			asNumber: function(str){
				return (isNumber(str)) ? str * 1 : nan;
			},
			numberToString: function(num){
				return (isNumber(num)) ? num : false;
			}
		},
		
		range: {
			minDefault: 0,
			maxDefault: 100
		},
		color: {
			mismatch: function(val){
				if(!val || val.length != 7 || !(/^\u0023/.test(val))){return true;}
				return isNaN(parseInt( val.charAt(1) + val.charAt(2), 16)) || isNaN(parseInt( val.charAt(3) + val.charAt(4), 16)) || isNaN(parseInt( val.charAt(5) + val.charAt(6), 16));
			}
		},
		date: {
			mismatch: function(val){
				if(!val || !val.split || !(/\d$/.test(val))){return true;}
				var i;
				var valA = val.split(/\u002D/);
				if(valA.length !== 3){return true;}
				var ret = false;
				
				
				if(valA[0].length < 4 || valA[1].length != 2 || valA[1] > 12 || valA[2].length != 2 || valA[2] > 33){
					ret = true;
				} else {
					for(i = 0; i < 3; i++){
						if(!isDateTimePart(valA[i])){
							ret = true;
							break;
						}
					}
				}
				
				return ret || (val !== this.dateToString( this.asDate(val, true) ) );
			},
			step: 1,
			//stepBase: 0, 0 = default
			stepScaleFactor:  86400000,
			asDate: function(val, _noMismatch){
				if(!_noMismatch && this.mismatch(val)){
					return null;
				}
				return new Date(this.asNumber(val, true));
			},
			asNumber: function(str, _noMismatch){
				var ret = nan;
				if(_noMismatch || !this.mismatch(str)){
					str = str.split(/\u002D/);
					ret = Date.UTC(str[0], str[1] - 1, str[2]);
				}
				return ret;
			},
			numberToString: function(num){
				return (isNumber(num)) ? this.dateToString(new Date( num * 1)) : false;
			},
			dateToString: function(date){
				return (date && date.getFullYear) ? addleadingZero(date.getUTCFullYear(), 4) +'-'+ addleadingZero(date.getUTCMonth()+1, 2) +'-'+ addleadingZero(date.getUTCDate(), 2) : false;
			}
		},
		time: {
			mismatch: function(val, _getParsed){
				if(!val || !val.split || !(/\d$/.test(val))){return true;}
				val = val.split(/\u003A/);
				if(val.length < 2 || val.length > 3){return true;}
				var ret = false,
					sFraction;
				if(val[2]){
					val[2] = val[2].split(/\u002E/);
					sFraction = parseInt(val[2][1], 10);
					val[2] = val[2][0];
				}
				$.each(val, function(i, part){
					if(!isDateTimePart(part) || part.length !== 2){
						ret = true;
						return false;
					}
				});
				if(ret){return true;}
				if(val[0] > 23 || val[0] < 0 || val[1] > 59 || val[1] < 0){
					return true;
				}
				if(val[2] && (val[2] > 59 || val[2] < 0 )){
					return true;
				}
				if(sFraction && isNaN(sFraction)){
					return true;
				}
				if(sFraction){
					if(sFraction < 100){
						sFraction *= 100;
					} else if(sFraction < 10){
						sFraction *= 10;
					}
				}
				return (_getParsed === true) ? [val, sFraction] : false;
			},
			step: 60,
			stepBase: 0,
			stepScaleFactor:  1000,
			asDate: function(val){
				val = new Date(this.asNumber(val));
				return (isNaN(val)) ? null : val;
			},
			asNumber: function(val){
				var ret = nan;
				val = this.mismatch(val, true);
				if(val !== true){
					ret = Date.UTC('1970', 0, 1, val[0][0], val[0][1], val[0][2] || 0);
					if(val[1]){
						ret += val[1];
					}
				}
				return ret;
			},
			dateToString: function(date){
				if(date && date.getUTCHours){
					var str = addleadingZero(date.getUTCHours(), 2) +':'+ addleadingZero(date.getUTCMinutes(), 2),
						tmp = date.getSeconds()
					;
					if(tmp != "0"){
						str += ':'+ addleadingZero(tmp, 2);
					}
					tmp = date.getUTCMilliseconds();
					if(tmp != "0"){
						str += '.'+ addleadingZero(tmp, 3);
					}
					return str;
				} else {
					return false;
				}
			}
		},
		month: {
			mismatch: function(val){
				return typeProtos.date.mismatch(val+'-01');
			},
			step: 1,
			stepScaleFactor:  false,
			//stepBase: 0, 0 = default
			asDate: function(val){
				return new Date(typeProtos.date.asNumber(val+'-01'));
			},
			asNumber: function(val){
				//1970-01
				var ret = nan;
				if(val && !this.mismatch(val)){
					val = val.split(/\u002D/);
					val[0] = (val[0] * 1) - 1970;
					val[1] = (val[1] * 1) - 1;
					ret = (val[0] * 12) + val[1];
				}
				return ret;
			},
			numberToString: function(num){
				var mod;
				var ret = false;
				if(isNumber(num)){
					mod = (num % 12);
					num = ((num - mod) / 12) + 1970;
					mod += 1;
					if(mod < 1){
						num -= 1;
						mod += 12;
					}
					ret = addleadingZero(num, 4)+'-'+addleadingZero(mod, 2);
					
				}
				
				return ret;
			},
			dateToString: function(date){
				if(date && date.getUTCHours){
					var str = typeProtos.date.dateToString(date);
					return (str.split && (str = str.split(/\u002D/))) ? str[0]+'-'+str[1] : false;
				} else {
					return false;
				}
			}
		}
//		,'datetime-local': {
//			mismatch: function(val, _getParsed){
//				if(!val || !val.split || (val+'special').split(/\u0054/).length !== 2){return true;}
//				val = val.split(/\u0054/);
//				return ( typeProtos.date.mismatch(val[0]) || typeProtos.time.mismatch(val[1], _getParsed) );
//			},
//			noAsDate: true,
//			asDate: function(val){
//				val = new Date(this.asNumber(val));
//				
//				return (isNaN(val)) ? null : val;
//			},
//			asNumber: function(val){
//				var ret = nan;
//				var time = this.mismatch(val, true);
//				if(time !== true){
//					val = val.split(/\u0054/)[0].split(/\u002D/);
//					
//					ret = Date.UTC(val[0], val[1] - 1, val[2], time[0][0], time[0][1], time[0][2] || 0);
//					if(time[1]){
//						ret += time[1];
//					}
//				}
//				return ret;
//			},
//			dateToString: function(date, _getParsed){
//				return typeProtos.date.dateToString(date) +'T'+ typeProtos.time.dateToString(date, _getParsed);
//			}
//		}
	};
	
	if(typeBugs || !supportsType('range') || !supportsType('time') || !supportsType('month')){
		typeProtos.range = $.extend({}, typeProtos.number, typeProtos.range);
		typeProtos.time = $.extend({}, typeProtos.date, typeProtos.time);
		typeProtos.month = $.extend({}, typeProtos.date, typeProtos.month);
//		typeProtos['datetime-local'] = $.extend({}, typeProtos.date, typeProtos.time, typeProtos['datetime-local']);
	}
	
	
	
	//'datetime-local'
	['number', 'month', 'range', 'date', 'time'].forEach(function(type){
		if(typeBugs || !supportsType(type)){
			webshims.addInputType(type, typeProtos[type]);
		}
	});
	
	if(!supportsType('color') && options.types && options.types.indexOf && options.types.indexOf('color') != -1){
		webshims.addInputType('color', typeProtos.color);
	}

	if($('<input />').prop('labels') == null){
		webshims.defineNodeNamesProperty('button, input, keygen, meter, output, progress, select, textarea', 'labels', {
			prop: {
				get: function(){
					if(this.type == 'hidden'){return null;}
					var id = this.id;
					var labels = $(this)
						.closest('label')
						.filter(function(){
							var hFor = (this.attributes['for'] || {});
							return (!hFor.specified || hFor.value == id);
						})
					;
					
					if(id) {
						labels = labels.add('label[for="'+ id +'"]');
					}
					return labels.get();
				},
				writeable: false
			}
		});
	}
	
});
(function($){
	
	var id = 0;
	var isNumber = function(string){
		return (typeof string == 'number' || (string && string == string * 1));
	};
	var retDefault = function(val, def){
		if(!(typeof val == 'number' || (val && val == val * 1))){
			return def;
		}
		return val * 1;
	};
	var createOpts = ['step', 'min', 'max', 'readonly', 'title', 'disabled', 'tabindex'];
	var rangeProto = {
		_create: function(){
			var i;
			
			
			this.element.addClass('ws-range').attr({role: 'slider'}).append('<span class="ws-range-min" /><span class="ws-range-rail"><span class="ws-range-thumb" /></span>');
			this.trail = $('.ws-range-rail', this.element);
			this.range = $('.ws-range-min', this.element);
			this.thumb = $('.ws-range-thumb', this.trail);
			
			this.updateMetrics();
			
			this.orig = this.options.orig;
			
			for(i = 0; i < createOpts.length; i++){
				this[createOpts[i]](this.options[createOpts[i]]);
			}
			this.value = this._value;
			this.value(this.options.value);
			this.initDataList();
			this.element.data('rangeUi', this);
			this.addBindings();
			this._init = true;
		},
		value: $.noop,
		_value: function(val, _noNormalize, animate){
			var left, posDif;
			var o = this.options;
			var oVal = val;
			var thumbStyle = {};
			var rangeStyle = {};
			if(!_noNormalize && parseFloat(val, 10) != val){
				val = o.min + ((o.max - o.min) / 2);
			}
			
			if(!_noNormalize){
				val = this.normalizeVal(val);
			}
			left =  100 * ((val - o.min) / (o.max - o.min));
			
			this.options.value = val;
			this.thumb.stop();
			this.range.stop();
			
			rangeStyle[this.dirs.width] = left+'%';
			if(this.vertical){
				left = Math.abs(left - 100);
			}
			thumbStyle[this.dirs.left] = left+'%';
			
			
			if(!animate){
				this.thumb.css(thumbStyle);
				this.range.css(rangeStyle);
			} else {
				if(typeof animate != 'object'){
					animate = {};
				} else {
					animate = $.extend({}, animate);
				}
				if(!animate.duration){
					posDif = Math.abs(left - parseInt(this.thumb[0].style[this.dirs.left] || 50, 10));
					animate.duration = Math.max(Math.min(999, posDif * 5), 99);
				}
				this.thumb.animate(thumbStyle, animate);
				this.range.animate(rangeStyle, animate);
			}
			if(this.orig && (oVal != val || (!this._init && this.orig.value != val)) ){
				this.options._change(val);
			}
			this.element.attr({
				'aria-valuenow': this.options.value,
				'aria-valuetext': this.options.textValue ? this.options.textValue(this.options.value) : this.options.options[this.options.value] || this.options.value
			});
		},
		initDataList: function(){
			if(this.orig){
				var listTimer;
				var that = this;
				var updateList = function(){
					$(that.orig)
						.jProp('list')
						.off('updateDatalist', updateList)
						.on('updateDatalist', updateList)
					;
					clearTimeout(listTimer);
					listTimer = setTimeout(function(){
						if(that.list){
							that.list();
						}
					}, 9);
					
				};
				
				$(this.orig).on('listdatalistchange', updateList);
				this.list();
			}
		},
		list: function(opts){
			var o = this.options;
			var min = o.min;
			var max = o.max;
			var trail = this.trail;
			var that = this;
			
			this.element.attr({'aria-valuetext': o.options[o.value] || o.value});
			$('.ws-range-ticks', trail).remove();
			
			
			$(this.orig).jProp('list').find('option:not([disabled])').each(function(){
				o.options[$.prop(this, 'value')] = $.prop(this, 'label') || '';
			});
			
			$.each(o.options, function(val, label){
				if(!isNumber(val) || val < min || val > max){return;}
				var left = 100 * ((val - min) / (max - min));
				var title = o.showLabels && label ? ' title="'+ label +'"' : '';
				if(that.vertical){
					left = Math.abs(left - 100);
				}
				
				that.posCenter(
					$('<span class="ws-range-ticks"'+ title +' data-label="'+label+'" style="'+(that.dirs.left)+': '+left+'%;" />').appendTo(trail)
				);
			});
		},
		readonly: function(val){
			val = !!val;
			this.options.readonly = val;
			this.element.attr('aria-readonly', ''+val);
		},
		disabled: function(val){
			val = !!val;
			this.options.disabled = val;
			if(val){
				this.element.attr({tabindex: -1, 'aria-disabled': 'true'});
			} else {
				this.element.attr({tabindex: this.options.tabindex, 'aria-disabled': 'false'});
			}
		},
		tabindex: function(val){
			this.options.tabindex = val;
			if(!this.options.disabled){
				this.element.attr({tabindex: val});
			}
		},
		title: function(val){
			this.element.prop('title', val);
		},
		min: function(val){
			this.options.min = retDefault(val, 0);
			this.value(this.options.value, true);
		},
		max: function(val){
			this.options.max = retDefault(val, 100);
			this.value(this.options.value, true);
		},
		step: function(val){
			this.options.step = val == 'any' ? 'any' : retDefault(val, 1);
			this.value(this.options.value);
		},
		
		normalizeVal: function(val){
			var valModStep, alignValue, step;
			var o = this.options;
			
			if(val <= o.min){
				val = o.min;
			} else if(val >= o.max) {
				val = o.max;
			} else if(o.step != 'any'){
				step = o.step;
				valModStep = (val - o.min) % step;
				alignValue = val - valModStep;
				
				if ( Math.abs(valModStep) * 2 >= step ) {
					alignValue += ( valModStep > 0 ) ? step : ( -step );
				}
				val = alignValue.toFixed(5) * 1;
			}
			return val;
		},
		doStep: function(factor, animate){
			var step = retDefault(this.options.step, 1);
			if(this.options.step == 'any'){
				step = Math.min(step, (this.options.max - this.options.min) / 10);
			}
			this.value( this.options.value + (step * factor), false, animate );
			
		},
		 
		getStepedValueFromPos: function(pos){
			var val, valModStep, alignValue, step;
			
			if(pos <= 0){
				val = this.options[this.dirs.min];
			} else if(pos > 100) {
				val = this.options[this.dirs.max];
			} else {
				if(this.vertical){
					pos = Math.abs(pos - 100);
				}
				val = ((this.options.max - this.options.min) * (pos / 100)) + this.options.min;
				step = this.options.step;
				if(step != 'any'){
					valModStep = (val - this.options.min) % step;
					alignValue = val - valModStep;
					
					if ( Math.abs(valModStep) * 2 >= step ) {
						alignValue += ( valModStep > 0 ) ? step : ( -step );
					}
					val = ((alignValue).toFixed(5)) * 1;
					
				}
			}
			
			return val;
		},
		addBindings: function(){
			var leftOffset, widgetUnits, hasFocus;
			var that = this;
			var o = this.options;
			
			var eventTimer = (function(){
				var events = {};
				return {
					init: function(name, curVal, fn){
						if(!events[name]){
							events[name] = {fn: fn};
							if(that.orig){
								$(that.orig).on(name, function(){
									events[name].val = $.prop(that.orig, 'value');
								});
							}
							
						}
						events[name].val = curVal;
					},
					call: function(name, val){
						if(events[name].val != val){
							clearTimeout(events[name].timer);
							events[name].val = val;
							events[name].timer = setTimeout(function(){
								events[name].fn(val, that);
							}, 0);
						}
					}
				};
			})();
			
			var setValueFromPos = function(e, animate){
				
				var val = that.getStepedValueFromPos((e[that.dirs.mouse] - leftOffset) * widgetUnits);
				if(val != o.value){
					that.value(val, false, animate);
					eventTimer.call('input', val);
				}
				if(e && e.type == 'mousemove'){
					e.preventDefault();
				}
			};
			
			var remove = function(e){
				if(e && e.type == 'mouseup'){
					eventTimer.call('input', o.value);
					eventTimer.call('change', o.value);
				}
				that.element.removeClass('ws-active');
				$(document).off('mousemove', setValueFromPos).off('mouseup', remove);
				$(window).off('blur', removeWin);
			};
			var removeWin = function(e){
				if(e.target == window){remove();}
			};
			var add = function(e){
				var outerWidth;
				e.preventDefault();
				$(document).off('mousemove', setValueFromPos).off('mouseup', remove);
				$(window).off('blur', removeWin);
				if(!o.readonly && !o.disabled){
					leftOffset = that.element.focus().addClass('ws-active').offset();
					widgetUnits = that.element[that.dirs.innerWidth]();
					if(!widgetUnits || !leftOffset){return;}
					outerWidth = that.thumb[that.dirs.outerWidth]();
					leftOffset = leftOffset[that.dirs.pos];
					widgetUnits = 100 / widgetUnits;
					setValueFromPos(e, o.animate);
					$(document)
						.on({
							mouseup: remove,
							mousemove: setValueFromPos
						})
					;
					$(window).on('blur', removeWin);
					e.stopPropagation();
				}
			};
			var elementEvts = {
				mousedown: add,
				focus: function(e){
					if(!o.disabled){
						eventTimer.init('input', o.value);
						eventTimer.init('change', o.value);
						that.element.addClass('ws-focus');
					}
					hasFocus = true;
				},
				blur: function(e){
					that.element.removeClass('ws-focus ws-active');
					hasFocus = false;
					eventTimer.init('input', o.value);
					eventTimer.call('change', o.value);
				},
				keyup: function(){
					that.element.removeClass('ws-active');
					eventTimer.call('input', o.value);
					eventTimer.call('change', o.value);
				},
				
				keydown: function(e){
					var step = true;
					var code = e.keyCode;
					if(!o.readonly && !o.disabled){
						if (code == 39 || code == 38) {
							that.doStep(1);
						} else if (code == 37 || code == 40) {
							that.doStep(-1);
						} else if (code == 33) {
							that.doStep(10, o.animate);
						} else if (code == 34) {
							that.doStep(-10, o.animate);
						} else if (code == 36) {
							that.value(that.options.max, false, o.animate);
						} else if (code == 35) {
							that.value(that.options.min, false, o.animate);
						} else {
							step = false;
						}
						if (step) {
							that.element.addClass('ws-active');
							eventTimer.call('input', o.value);
							e.preventDefault();
						}
					}
				}
			};
			
			eventTimer.init('input', o.value, this.options.input);
			eventTimer.init('change', o.value, this.options.change);
			
			elementEvts[$.fn.mwheelIntent ? 'mwheelIntent' : 'mousewheel'] = function(e, delta){
				if(delta && hasFocus && !o.readonly && !o.disabled){
					that.doStep(delta);
					e.preventDefault();
					eventTimer.call('input', o.value);
				}
			};
			this.element.on(elementEvts);
			this.thumb.on({
				mousedown: add
			});
			$(function(){
				$.webshims.ready('dom-support', function(){
					that.element.onWSOff('updateshadowdom', function(){
						that.updateMetrics();
					});
				});
				if(!$.fn.onWSOff){
					$.webshims._polyfill(['dom-support']);
				}
			});
		},
		posCenter: function(elem, outerWidth){
			var temp;
			if(this.options.calcCenter && (!this._init || this.element[0].offsetWidth)){
				if(!elem){
					elem = this.thumb;
				}
				if(!outerWidth){
					outerWidth = elem[this.dirs.outerWidth]();
				}
				outerWidth = outerWidth / -2;
				elem.css(this.dirs.marginLeft, outerWidth);
				
				if(this.options.calcTrail && elem[0] == this.thumb[0]){
					temp = this.element[this.dirs.innerHeight]();
					elem.css(this.dirs.marginTop, (elem[this.dirs.outerHeight]() - temp) / -2);
					this.range.css(this.dirs.marginTop, (this.range[this.dirs.outerHeight]() - temp) / -2 );
					outerWidth *= -1;
					this.trail
						.css(this.dirs.left, outerWidth)
						.css(this.dirs.right, outerWidth)
					;
				}
			}
		},
		updateMetrics: function(){
			var width = this.element.innerWidth();
			this.vertical = (width && this.element.innerHeight() - width  > 10);
			
			this.dirs = this.vertical ? 
				{mouse: 'pageY', pos: 'top', min: 'max', max: 'min', left: 'top', right: 'bottom', width: 'height', innerWidth: 'innerHeight', innerHeight: 'innerWidth', outerWidth: 'outerHeight', outerHeight: 'outerWidth', marginTop: 'marginLeft', marginLeft: 'marginTop'} :
				{mouse: 'pageX', pos: 'left', min: 'min', max: 'max', left: 'left', right: 'right', width: 'width', innerWidth: 'innerWidth', innerHeight: 'innerHeight', outerWidth: 'outerWidth', outerHeight: 'outerHeight', marginTop: 'marginTop', marginLeft: 'marginLeft'}
			;
			this.element
				[this.vertical ? 'addClass' : 'removeClass']('vertical-range')
				[this.vertical ? 'addClass' : 'removeClass']('horizontal-range')
			;
			this.posCenter();
		}
	};
	
	$.fn.rangeUI = function(opts){
		opts = $.extend({
			readonly: false, 
			disabled: false, 
			tabindex: 0, 
			min: 0, 
			step: 1, 
			max: 100, 
			value: 50, 
			input: $.noop, 
			change: $.noop, 
			_change: $.noop, 
			showLabels: true, 
			options: {},
			calcCenter: true,
			calcTrail: true
		}, opts);
		return this.each(function(){
			$.webshims.objectCreate(rangeProto, {
				element: {
					value: $(this)
				}
			}, opts);
		});
	};
	jQuery.webshims.isReady('range-ui', true);
})(jQuery);
jQuery.webshims.register('form-number-date-ui', function($, webshims, window, document, undefined, options){
	"use strict";
	var curCfg;
	var formcfg = $.webshims.formcfg;
	
	var stopPropagation = function(e){
		e.stopImmediatePropagation(e);
	};
	var createFormat = function(name){
		if(!curCfg.patterns[name+'Obj']){
			var obj = {};
			$.each(curCfg.patterns[name].split(curCfg[name+'Format']), function(i, name){
				obj[name] = i;
			});
			curCfg.patterns[name+'Obj'] = obj;
		}
	};
	var splitInputs = {
		date: {
			_create: function(){
				var obj = {
					splits: [$('<input type="text" class="yy" size="4" inputmode="numeric" />')[0], $('<input type="text" class="mm" inputmode="numeric" maxlength="2" size="2" />')[0], $('<input type="text" class="dd ws-spin" inputmode="numeric" maxlength="2" size="2" />')[0]] 
				};
				obj.elements = [obj.splits[0], $('<span class="ws-input-seperator" />')[0], obj.splits[1], $('<span class="ws-input-seperator" />')[0], obj.splits[2]];
				return obj;
			},
			sort: function(element){
				createFormat('d');
				var i = 0;
				var seperators = $('.ws-input-seperator', element).html(curCfg.dFormat);
				var inputs = $('input', element);
				$.each(curCfg.patterns.dObj, function(name, value){
					var input = inputs.filter('.'+ name);
					if(input[0]){
						
						input.appendTo(element);
						if(i < seperators.length){
							seperators.eq(i).insertAfter(input);
						}
						i++;
					}
				});
			}
		},
		month: {
			_create: function(){
				var obj = {
					splits: [$('<input type="text" class="yy" size="4" />')[0], $('<input type="text" class="mm ws-spin" />')[0]] 
				};
				obj.elements = [obj.splits[0], $('<span class="ws-input-seperator" />')[0], obj.splits[1]];
				return obj;
			},
			sort: function(element){
				var seperator = $('.ws-input-seperator', element).html(curCfg.dFormat);
				var mm = $('input.mm', element);
				var action;
				if(curCfg.date.showMonthAfterYear){
					mm.appendTo(element);
					action = 'insertBefore';
				} else {
					mm.prependTo(element);
					action = 'insertAfter';
				}
				seperator[action](mm);
			}
		}
	};
	var labelWidth = (function(){
		var getId = function(){
			return webshims.getID(this);
		};
		return function(element, labels, noFocus){
			$(element).attr({'aria-labelledby': labels.map(getId).get().join(' ')});
			if(!noFocus){
				labels.on('click', function(e){
					element.getShadowFocusElement().focus();
					e.preventDefault();
					return false;
				});
			}
		};
	})();
	var addZero = function(val){
		if(!val){return "";}
		val = val+'';
		return val.length == 1 ? '0'+val : val;
	};
	
		
	(function(){
		var monthDigits = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
		formcfg.de = {
			numberFormat: {
				",": ".",
				".": ","
			},
			timeSigns: ":. ",
			numberSigns: ',',
			dateSigns: '.',
			dFormat: ".",
			patterns: {
				d: "dd.mm.yy"
			},
			month:  {
				currentText: 'Aktueller Monat'
			},
			date: {
				close: 'schließen',
				clear: 'Löschen',
				prevText: 'Zurück',
				nextText: 'Vor',
				currentText: 'Heute',
				monthNames: ['Januar','Februar','März','April','Mai','Juni',
				'Juli','August','September','Oktober','November','Dezember'],
				monthNamesShort: ['Jan','Feb','Mär','Apr','Mai','Jun',
				'Jul','Aug','Sep','Okt','Nov','Dez'],
				dayNames: ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'],
				dayNamesShort: ['So','Mo','Di','Mi','Do','Fr','Sa'],
				dayNamesMin: ['So','Mo','Di','Mi','Do','Fr','Sa'],
				weekHeader: 'KW',
				firstDay: 1,
				isRTL: false,
				showMonthAfterYear: false,
				yearSuffix: ''
			}
		};
		
		formcfg.en = {
			numberFormat: {
				".": ".",
				",": ","
			},
			numberSigns: '.',
			dateSigns: '/',
			timeSigns: ":. ",
			dFormat: "/",
			patterns: {
				d: "mm/dd/yy"
			},
			month:  {
				currentText: 'This month'
			},
			date: {
				"closeText": "Done",
				clear: 'Clear',
				"prevText": "Prev",
				"nextText": "Next",
				"currentText": "Today",
				"monthNames": ["January","February","March","April","May","June","July","August","September","October","November","December"],
				"monthNamesShort": ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
				"dayNames": ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],
				"dayNamesShort": ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],
				"dayNamesMin": ["Su","Mo","Tu","We","Th","Fr","Sa"],
				"weekHeader": "Wk",
				"firstDay": 0,
				"isRTL": false,
				"showMonthAfterYear": false,
				"yearSuffix": ""
			}
		};
		
		formcfg['en-US'] = formcfg['en-US'] || formcfg['en'];
		formcfg[''] = formcfg[''] || formcfg['en-US'];
		curCfg = formcfg[''];
		
		var createMonthKeys = function(langCfg){
			if(!langCfg.date.monthkeys){
				var create = function(i, name){
					var strNum;
					var num = i + 1;
					strNum = (num < 10) ? '0'+num : ''+num;
					langCfg.date.monthkeys[num] = strNum;
					langCfg.date.monthkeys[name] = strNum;
					langCfg.date.monthkeys[name.toLowerCase()] = strNum;
				};
				langCfg.date.monthkeys = {};
				langCfg.date.monthDigits = monthDigits;
				langCfg.numberSigns += '-';
				$.each(langCfg.date.monthNames, create);
				$.each(langCfg.date.monthNamesShort, create);
			}
		};
		
		createMonthKeys(curCfg);
		
		$.webshims.ready('dom-extend', function(){
			$.webshims.activeLang({
				register: 'form-core', 
				callback: function(){
					$.each(arguments, function(i, val){
						if(formcfg[val]){
							curCfg = formcfg[val];
							createMonthKeys(curCfg);
							$(document).triggerHandler('wslocalechange');
							return false;
						}
					});
				}
			});
		});
	})();
		
	
	
	(function(){
		
		
		var mousePress = function(e){
			$(this)[e.type == 'mousepressstart' ? 'addClass' : 'removeClass']('mousepress-ui');
		};
		
		var retDefault = function(val, def){
			if(!(typeof val == 'number' || (val && val == val * 1))){
				return def;
			}
			return val * 1;
		};
		
		var createOpts = ['step', 'min', 'max', 'readonly', 'title', 'disabled', 'tabindex', 'placeholder', 'value'];
		
		
		var formatVal = {
			number: function(val){
				return (val+'').replace(/\,/g, '').replace(/\./, curCfg.numberFormat['.']);
			},
			time: function(val){
				return val;
			},
			//todo empty val for month/split
			month: function(val, options){
				var names;
				var p = val.split('-');
				if(p[0] && p[1]){
					names = curCfg.date[options.formatMonthNames] || curCfg.date[options.monthNames] || curCfg.date.monthNames;
					p[1] = names[(p[1] * 1) - 1];
					if(options && options.splitInput){
						val = [p[0] || '', p[1] || ''];
					} else if(p[1]){
						val = curCfg.date.showMonthAfterYear ? p.join(' ') : p[1]+' '+p[0];
					}
				}
				return val;
			},
			date: function(val, opts){
				var p = (val+'').split('-');
				if(p[2] && p[1] && p[0]){
					if(opts && opts.splitInput){
						val = p;
					} else {
						val = curCfg.patterns.d.replace('yy', p[0] || '');
						val = val.replace('mm', p[1] || '');
						val = val.replace('dd', p[2] || '');
					}
				} else if(opts && opts.splitInput){
					val = [p[0] || '', p[1] || '', p[2] || ''];
				}
				
				return val;
			}
		};
		
		var parseVal = {
			number: function(val){
				return (val+'').replace(curCfg.numberFormat[','], '').replace(curCfg.numberFormat['.'], '.');
			},
			time: function(val){
				return val;
			},
			month: function(val, opts){
				
				var p = (!opts.splitInput) ? val.trim().split(/[\.\s-\/\\]+/) : val;
				
				if(p.length == 2){
					p[0] = curCfg.date.monthkeys[p[0]] || p[0];
					p[1] = curCfg.date.monthkeys[p[1]] || p[1];
					if(p[1].length == 2){
						val = p[0]+'-'+p[1];
					} else if(p[0].length == 2){
						val = p[1]+'-'+p[0];
					} else {
						val = '';
					}
				} else if(opts.splitInput) {
					val = '';
				}
				return val;
			},
			date: function(val, opts){
				createFormat('d');
				var i;
				var obj;
				if(opts.splitInput){
					obj = {yy: 0, mm: 1, dd: 2};
				} else {
					obj = curCfg.patterns.dObj;
					val = val.split(curCfg.dFormat);
				}
				
				return (val.length == 3 && val[0] && val[1] && val[2]) ? 
					([addZero(val[obj.yy]), addZero(val[obj.mm]), addZero(val[obj.dd])]).join('-') : 
					''
				;
			}
		};
		
		var steps = {
			number: {
				step: 1
			},
			time: {
				step: 60
			},
			month: {
				step: 1,
				start: new Date()
			},
			date: {
				step: 1,
				start: new Date()
			}
		};
		
		
		var placeholderFormat = {
			date: function(val, opts){
				var hintValue = (val || '').split('-');
				if(hintValue.length == 3){
					hintValue = opts.splitInput ? 
						hintValue : 
						curCfg.patterns.d.replace('yy', hintValue[0]).replace('mm', hintValue[1]).replace('dd', hintValue[2]);
				} else {
					hintValue = opts.splitInput ?
						[val, val, val] :
						val;
				}
				return hintValue;
			},
			month: function(val, opts){
				var hintValue = (val || '').split('-');
				
				if(hintValue.length == 2){
					hintValue = opts.splitInput ? 
						hintValue : 
						curCfg.patterns.d.replace('yy', hintValue[0]).replace('mm', hintValue[1]);
				} else {
					hintValue = opts.splitInput ?
						[val, val] :
						val;
				}
				return hintValue;
			}
		};
		
		var createHelper = (function(){
			var types = {};
			return function(type){
				var input;
				if(!types[type]){
					input = $('<input type="'+type+'" />');
					types[type] = {
						asNumber: function(val){
							var type = (typeof val == 'object') ? 'valueAsDate' : 'value';
							return input.prop(type, val).prop('valueAsNumber');
						},
						asValue: function(val){
							var type = (typeof val == 'object') ? 'valueAsDate' : 'valueAsNumber';
							return input.prop(type, val).prop('value');
						}
					};
				}
				return types[type];
			};
		})();
		
		steps.range = steps.number;
		
		
		var spinBtnProto = {
			_create: function(){
				var i;
				var o = this.options;
				var helper = createHelper(o.type);
				this.type = o.type;
				this.orig = o.orig;
				
				this.elemHelper = $('<input type="'+ this.type+'" />');
				this.asNumber = helper.asNumber;
				this.asValue = helper.asValue;
				
				this.buttonWrapper = $('<span class="input-buttons '+this.type+'-input-buttons"><span unselectable="on" class="step-controls"><span class="step-up"></span><span class="step-down"></span></span></span>')
					.insertAfter(this.element)
				;
				
				if(o.splitInput){
					this._addSplitInputs();
				} else {
					this.inputElements = this.element;
				}
				
				if(this.type == 'number'){
					this.inputElements.attr('inputmode', 'numeric');
				}
				
				this.options.containerElements.push(this.buttonWrapper[0]);
				
				if(typeof steps[this.type].start == 'object'){
					steps[this.type].start = this.asNumber(steps[this.type].start);
				}
				
				
				
				for(i = 0; i < createOpts.length; i++){
					if(o[createOpts[i]] != null){
						this[createOpts[i]](o[createOpts[i]]);
					}
				}
				
				this.element.data('wsspinner', this);
				
				this.addBindings();
				
				if(!o.min && typeof o.relMin == 'number'){
					o.min = this.asValue(this.getRelNumber(o.relMin));
					$.prop(this.orig, 'min', o.min);
				}
				
				if(!o.max && typeof o.relMax == 'number'){
					o.max = this.asValue(this.getRelNumber(o.relMax));
					$.prop(this.orig, 'max', o.max);
				}
				
				this._init = true;
			},
			_addSplitInputs: function(){
				if(!this.inputElements){
					var create = splitInputs[this.type]._create();
					this.splits = create.splits;
					this.inputElements = $(create.elements).prependTo(this.element).filter('input');
				}
			},
			parseValue: function(){
				var value = this.inputElements.map(function(){
					return $.prop(this, 'value');
				}).get();
				if(!this.options.splitInput){
					value = value[0];
				}
				return parseVal[this.type](value, this.options);
			},
			formatValue: function(val, noSplit){
				return formatVal[this.type](val, noSplit === false ? false : this.options);
			},
			placeholder: function(val){
				var options = this.options;
				options.placeholder = val;
				var placeholder = val;
				if(placeholderFormat[this.type]){
					placeholder = placeholderFormat[this.type](val, this.options);
				}
				if(options.splitInput && typeof placeholder == 'object'){
					$.each(this.splits, function(i, elem){
						$.prop(elem, 'placeholder', placeholder[i]);
					});
				} else {
					this.element.prop('placeholder', placeholder);
				}
			},
			getRelNumber: function(rel){
				var start = steps[this.type].start || 0;
				if(rel){
					start += rel;
				}
				return start;
			},
			addZero: addZero,
			_setStartInRange: function(){
				var start = this.getRelNumber(this.options.relDefaultValue);
				if(!isNaN(this.minAsNumber) && start < this.minAsNumber){
					start = this.minAsNumber;
				} else if(!isNaN(this.maxAsNumber) && start > this.maxAsNumber){
					start = this.maxAsNumber;
				}
				this.elemHelper.prop('valueAsNumber', start);
				this.options.defValue = this.elemHelper.prop('value');
				
			},
			reorderInputs: function(){
				if(splitInputs[this.type]){
					var element = this.element;
					splitInputs[this.type].sort(element);
					setTimeout(function(){
						var data = webshims.data(element);
						if(data && data.shadowData){
							data.shadowData.shadowFocusElement = element.find('input')[0] || element[0];
						}
					}, 9);
				}
			},
			value: function(val){
				this.valueAsNumber = this.asNumber(val);
				this.options.value = val;
				if(isNaN(this.valueAsNumber) || (!isNaN(this.minAsNumber) && this.valueAsNumber < this.minAsNumber) || (!isNaN(this.maxAsNumber) && this.valueAsNumber > this.maxAsNumber)){
					this._setStartInRange();
				} else {
					this.elemHelper.prop('value', val);
					this.options.defValue = "";
				}
				
				val = formatVal[this.type](val, this.options);
				if(this.options.splitInput){
					
					$.each(this.splits, function(i, elem){
						$.prop(elem, 'value', val[i]);
					});
				} else {
					this.element.prop('value', val);
				}
				
				this._propertyChange('value');
			},
			initDataList: function(){
				var listTimer;
				var that = this;
				var updateList = function(){
					$(that.orig)
						.jProp('list')
						.off('updateDatalist', updateList)
						.on('updateDatalist', updateList)
					;
					clearTimeout(listTimer);
					listTimer = setTimeout(function(){
						if(that.list){
							that.list();
						}
					}, 9);
					
				};
				
				$(this.orig).onTrigger('listdatalistchange', updateList);
			},
			getOptions: function(){
				var options = {};
				var datalist = $(this.orig).jProp('list');
				datalist.find('option').each(function(){
					options[$.prop(this, 'value')] = $.prop(this, 'label');
				});
				return [options, datalist.data('label')];
			},
			list: function(val){
				if(this.type == 'number' || this.type == 'time'){
					this.element.attr('list', $.attr(this.orig, 'list'));
				}
				this.options.list = val;
				this._propertyChange('list');
			},
			_propertyChange: $.noop,
			tabindex: function(val){
				this.options.tabindex = val;
				this.inputElements.prop('tabindex', this.options.tabindex);
				$('button', this.buttonWrapper).prop('tabindex', this.options.tabindex);
			},
			title: function(val){
				this.options.title = val;
				this.element.prop('title', this.options.title);
			},
			
			min: function(val){
				this.elemHelper.prop('min', val);
				this.minAsNumber = this.asNumber(val);
				if(this.valueAsNumber != null && isNaN(this.valueAsNumber)){
					this._setStartInRange();
				}
				this.options.min = val;
				this._propertyChange('min');
			},
			max: function(val){
				this.elemHelper.prop('max', val);
				this.maxAsNumber = this.asNumber(val);
				if(this.valueAsNumber != null && isNaN(this.valueAsNumber)){
					this._setStartInRange();
				}
				this.options.max = val;
				this._propertyChange('max');
			},
			step: function(val){
				var defStep = steps[this.type];
				this.options.step = val;
				this.elemHelper.prop('step', retDefault(val, defStep.step));
			},
			addBindings: function(){
				var isFocused;
				
				var that = this;
				var o = this.options;
				
				var eventTimer = (function(){
					var events = {};
					return {
						init: function(name, curVal, fn){
							if(!events[name]){
								events[name] = {fn: fn};
								$(that.orig).on(name, function(){
									events[name].val = $.prop(that.orig, 'value');
								});
							}
							events[name].val = curVal;
						},
						call: function(name, val){
							if(events[name] && events[name].val != val){
								clearTimeout(events[name].timer);
								events[name].val = val;
								events[name].timer = setTimeout(function(){
									events[name].fn(val, that);
								}, 9);
							}
						}
					};
				})();
				var initChangeEvents = function(){
					eventTimer.init('input', $.prop(that.orig, 'value'), that.options.input);
					eventTimer.init('change', $.prop(that.orig, 'value'), that.options.change);
				};
				
				var step = {};
				
				var preventBlur = function(e){
					if(preventBlur.prevent){
						e.preventDefault();
						(isFocused || that.element.getShadowFocusElement()).focus();
						e.stopImmediatePropagation();
						return true;
					}
				};
				var callSplitChange = (function(){
					var timer;
					
					var call = function(e){
						var val;
						clearTimeout(timer);
						val = that.parseValue();
						$.prop(that.orig, 'value', val);
						eventTimer.call('input', val);
						if(!e || e.type != 'wsupdatevalue'){
							eventTimer.call('change', val);
						}
					};
					
					var onFocus = function(){
						clearTimeout(timer);
					};
					var onBlur = function(e){
						clearTimeout(timer);
						timer = setTimeout(call, 0);
						
						if(e.type == 'change'){
							stopPropagation(e);
							if(!o.splitInput){
								call();
							}
						}
					};
					
					that.element.on('wsupdatevalue', call);
					
					that.inputElements
						.add(that.buttonWrapper)
						.add(that.element)
						.on(
							{
								'focus focusin': onFocus,
								'blur focusout change': onBlur
							}
						)
					;
					setTimeout(function(){
						if(that.popover){
							$('> *', that.popover.element)
								.on({
									'focusin': onFocus,
									'focusout': onBlur
								})
							;
						}
					}, 0);
				})();
				
				var spinEvents = {};
				var spinElement = o.splitInput ? this.inputElements.filter('.ws-spin') : this.inputElements.eq(0);
				var elementEvts = {
					blur: function(e){
						if(!preventBlur(e) && !o.disabled && !o.readonly){
							if(!preventBlur.prevent){
								isFocused = false;
							}
						}
						stopPropagation(e);
					},
					focus: function(e){
						if(!isFocused){
							initChangeEvents();
							isFocused = this;
						}
					},
					keypress: function(e){
						if(e.isDefaultPrevented()){return;}
						var chr;
						var stepped = true;
						var code = e.keyCode;
						if(!e.ctrlKey && !e.metaKey && curCfg[that.type+'Signs']){
							chr = String.fromCharCode(e.charCode == null ? code : e.charCode);
							stepped = !(chr < " " || (curCfg[that.type+'Signs']+'0123456789').indexOf(chr) > -1);
						} else {
							stepped = false;
						}
						if(stepped){
							e.preventDefault();
						}
					},
					'input keydown keypress': (function(){
						var timer;
						var isStopped = false;
						var releaseTab = function(){
							if(isStopped === true){
								isStopped = 'semi';
								timer = setTimeout(releaseTab, 250);
							} else {
								isStopped = false;
							}
						};
						var stopTab = function(){
							isStopped = true;
							clearTimeout(timer);
							timer = setTimeout(releaseTab, 300);
						};
						var select = function(){
							this.focus();
							this.select();
							stopTab();
						};
						
						return function(e){
							if(o.splitInput && o.jumpInputs){
								if(e.type == 'input'){
									if($.prop(this, 'value').length === $.prop(this, 'maxLength')){
										try {
											$(this)
												.next()
												.next('input')
												.each(select)
											;
										} catch(er){}
									}
								} else if(!e.shiftKey && !e.crtlKey && e.keyCode == 9 && (isStopped === true || (isStopped && !$.prop(this, 'value')))){
									e.preventDefault();
								}
							}
						}
					})()
				};
				var mouseDownInit = function(){
					if(!o.disabled && !isFocused){
						that.element.getShadowFocusElement().focus();
					}
					preventBlur.set();
					
					return false;
				};
				
				preventBlur.set = (function(){
					var timer;
					var reset = function(){
						preventBlur.prevent = false;
					};
					return function(){
						clearTimeout(timer);
						preventBlur.prevent = true;
						setTimeout(reset, 9);
					};
				})();
				
				['stepUp', 'stepDown'].forEach(function(name){
					step[name] = function(factor){
						if(!o.disabled && !o.readonly){
							if(!isFocused){
								mouseDownInit();
							}
							var ret = false;
							if (!factor) {
								factor = 1;
							}
							try {
								that.elemHelper[name](factor);
								ret = that.elemHelper.prop('value');
								that.value(ret);
								eventTimer.call('input', ret);
							} catch (er) {}
							return ret;
						}
					};
				});
				
				
				
				this.buttonWrapper.on('mousedown', mouseDownInit);
				
				this.setInput = function(value){
					that.value(value);
					eventTimer.call('input', value);
				};
				this.setChange = function(value){
					that.setInput(value);
					eventTimer.call('change', value);
				};
				
				
				
				this.inputElements.on(elementEvts);
				
				if(!o.noSpinbtn){
					spinEvents[$.fn.mwheelIntent ? 'mwheelIntent' : 'mousewheel'] = function(e, delta){
						if(delta && isFocused && !o.disabled){
							step[delta > 0 ? 'stepUp' : 'stepDown']();
							e.preventDefault();
						}
					};
					spinEvents.keydown = function(e){
						if(o.list || e.isDefaultPrevented() || $.attr(this, 'list')){return;}
						var stepped = true;
						var code = e.keyCode;
						if (code == 38) {
							step.stepUp();
						} else if (code == 40) {
							step.stepDown();
						} else {
							stepped = false;
						}
						if(stepped){
							e.preventDefault();
						}
					};
					
					spinElement.attr({'autocomplete': 'off', role: 'spinbutton'}).on(spinEvents);
				}
				
				(function(){
					var localeChange ;
					if(!o.splitInput){
						localeChange = function(){
							if(o.value){
								that.value(o.value);
							}
	
							if(placeholderFormat[that.type] && o.placeholder){
								that.placeholder(o.placeholder);
							}
						};
					} else {
						localeChange = function(){
							that.reorderInputs();
						};
						that.reorderInputs();
					}
					$(that.orig).onWSOff('wslocalechange', localeChange);
				})();
				
				$('.step-up', this.buttonWrapper)
					.on({
						'mousepressstart mousepressend': mousePress,
						'mousedown mousepress': function(e){
							step.stepUp();
						}
					})
				;
				$('.step-down', this.buttonWrapper)
					.on({
						'mousepressstart mousepressend': mousePress,
						'mousedown mousepress': function(e){
							step.stepDown();
						}
					})
				;
				initChangeEvents();
			}
		};
		
		['readonly', 'disabled'].forEach(function(name){
			var isDisabled = name == 'disabled';
			spinBtnProto[name] = function(val){
				if(this.options[name] != val || !this._init){
					this.options[name] = !!val;
					this.inputElements.prop(name, this.options[name]);
					this.buttonWrapper[this.options[name] ? 'addClass' : 'removeClass']('ws-'+name);
				}
				if(isDisabled){
					$('button', this.buttonWrapper).prop('disabled', this.options[name]);
				}
			};
		});
		
		
		$.fn.spinbtnUI = function(opts){
			opts = $.extend({
				monthNames: 'monthNames',
				size: 1,
				startView: 0
			}, opts);
			return this.each(function(){
				$.webshims.objectCreate(spinBtnProto, {
					element: {
						value: $(this)
					}
				}, opts);
			});
		};
	})();
	
	(function(){
		var picker = {};
		var disable = {
			
		};
		
		var getDateArray = function(date){
			var ret = [date.getFullYear(), addZero(date.getMonth() + 1), addZero(date.getDate())];
			ret.month = ret[0]+'-'+ret[1];
			ret.date = ret[0]+'-'+ret[1]+'-'+ret[2];
			return ret;
		};
		var today = getDateArray(new Date());
		
		var _setFocus = function(element, _noFocus){
			var setFocus, that;
			element = $(element || this.activeButton);
			this.activeButton.attr({tabindex: '-1', 'aria-selected': 'false'});
			this.activeButton = element.attr({tabindex: '0', 'aria-selected': 'true'});
			this.index = this.buttons.index(this.activeButton[0]);
			
			clearTimeout(this.timer);
			
			if(!this.popover.openedByFocus && !_noFocus){
				that = this;
				setFocus = function(noTrigger){
					clearTimeout(that.timer);
					that.timer = setTimeout(function(){
						if(element[0]){
							element[0].focus();
							if(noTrigger !== true && !element.is(':focus')){
								setFocus(true);
							}
						}
					}, that.popover.isVisible ? 99 : 360);
				};
				this.popover.activateElement(element);
				setFocus();
			}
			
		};
		
		var _initialFocus = function(){
			var sel;
			if(this.popover.navedInitFocus){
				sel = this.popover.navedInitFocus.sel || this.popover.navedInitFocus;
				if((!this.activeButton || !this.activeButton[0]) && this.buttons[sel]){
					this.activeButton = this.buttons[sel]();
				} else if(sel){
					this.activeButton = $(sel, this.element);
				}
				
				if(!this.activeButton[0] && this.popover.navedInitFocus.alt){
					this.activeButton = this.buttons[this.popover.navedInitFocus.alt]();
				}
			}
			
			if(!this.activeButton || !this.activeButton[0]){
				this.activeButton = this.buttons.filter('.checked-value');
			}
			
			if(!this.activeButton[0]){
				this.activeButton = this.buttons.filter('.this-value');
			}
			if(!this.activeButton[0]){
				this.activeButton = this.buttons.eq(0);
			}
			
			this.setFocus(this.activeButton, this.opts.noFocus);
		};
		
		
		webshims.ListBox = function (element, popover, opts){
			this.element = $('ul', element);
			this.popover = popover;
			this.opts = opts || {};
			this.buttons = $('button:not(:disabled)', this.element);
			
			
			this.ons(this);
			this._initialFocus();
		};
		
		webshims.ListBox.prototype = {
			setFocus: _setFocus,
			_initialFocus: _initialFocus,
			prev: function(){
				var index = this.index - 1;
				if(index < 0){
					if(this.opts.prev){
						this.popover.navedInitFocus = 'last';
						this.popover.actionFn(this.opts.prev);
						this.popover.navedInitFocus = false;
					}
				} else {
					this.setFocus(this.buttons.eq(index));
				}
			},
			next: function(){
				var index = this.index + 1;
				if(index >= this.buttons.length){
					if(this.opts.next){
						this.popover.navedInitFocus = 'first';
						this.popover.actionFn(this.opts.next);
						this.popover.navedInitFocus = false;
					}
				} else {
					this.setFocus(this.buttons.eq(index));
				}
			},
			ons: function(that){
				this.element
					.on({
						'keydown': function(e){
							var handled;
							var key = e.keyCode;
							if(e.ctrlKey){return;}
							if(key == 36 || key == 33){
								that.setFocus(that.buttons.eq(0));
								handled = true;
							} else if(key == 34 || key == 35){
								that.setFocus(that.buttons.eq(that.buttons.length - 1));
								handled = true;
							} else if(key == 38 || key == 37){
								that.prev();
								handled = true;
							} else if(key == 40 || key == 39){
								that.next();
								handled = true;
							}
							if(handled){
								return false;
							}
						}
					})
				;
			}
		};
		
		webshims.Grid = function (element, popover, opts){
			this.element = $('tbody', element);
			this.popover = popover;
			this.opts = opts || {};
			this.buttons = $('button:not(:disabled,.othermonth)', this.element);
			
			this.ons(this);
			
			this._initialFocus();
			if(this.popover.openedByFocus){
				this.popover.activeElement = this.activeButton;
			}
		};
		
		
		
		webshims.Grid.prototype = {
			setFocus: _setFocus,
			_initialFocus: _initialFocus,
			
			first: function(){
				this.setFocus(this.buttons.eq(0));
			},
			last: function(){
				this.setFocus(this.buttons.eq(this.buttons.length - 1));
			},
			upPage: function(){
				$('.ws-picker-header > button:not(:disabled)', this.popover.element).trigger('click');
			},
			downPage: function(){
				this.activeButton.filter(':not([data-action="changeInput"])').trigger('click');
			},
			ons: function(that){
				this.element
					.on({
						'keydown': function(e){
							var handled;
							var key = e.keyCode;
							
							if(e.shiftKey){return;}
							
							if((e.ctrlKey && key == 40)){
								handled = 'downPage';
							} else if((e.ctrlKey && key == 38)){
								handled = 'upPage';
							} else if(key == 33 || (e.ctrlKey && key == 37)){
								handled = 'prevPage';
							} else if(key == 34 || (e.ctrlKey && key == 39)){
								handled = 'nextPage';
							} else if(e.keyCode == 36 || e.keyCode == 33){
								handled = 'first';
							} else if(e.keyCode == 35){
								handled = 'last';
							} else if(e.keyCode == 38){
								handled = 'up';
							} else if(e.keyCode == 37){
								handled = 'prev';
							} else if(e.keyCode == 40){
								handled = 'down';
							} else if(e.keyCode == 39){
								handled = 'next';
							}
							if(handled){
								that[handled]();
								return false;
							}
						}
					})
				;
			}
		};
		$.each({
			prevPage: {get: 'last', action: 'prev'}, 
			nextPage: {get: 'first', action: 'next'}
		}, function(name, val){
			webshims.Grid.prototype[name] = function(){
				if(this.opts[val.action]){
					this.popover.navedInitFocus = {
						sel: 'button[data-id="'+ this.activeButton.attr('data-id') +'"]:not(:disabled,.othermonth)',
						alt: val.get
					};
					this.popover.actionFn(this.opts[val.action]);
					this.popover.navedInitFocus = false;
				}
			};
		});
		
		$.each({
			up: {traverse: 'prevAll', get: 'last', action: 'prev', reverse: true}, 
			down: {traverse: 'nextAll', get: 'first', action: 'next'}
		}, function(name, val){
			webshims.Grid.prototype[name] = function(){
				var cellIndex = this.activeButton.closest('td').prop('cellIndex');
				var sel = 'td:nth-child('+(cellIndex + 1)+') button:not(:disabled,.othermonth)';
				var button = this.activeButton.closest('tr')[val.traverse]();
				
				if(val.reverse){
					button = $(button.get().reverse());
				}
				button = button.find(sel)[val.get]();
				
				if(!button[0]){
					if(this.opts[val.action]){
						this.popover.navedInitFocus = sel+':'+val.get;
						this.popover.actionFn(this.opts[val.action]);
						this.popover.navedInitFocus = false;
					}
				} else {
					this.setFocus(button.eq(0));
				}
			};
		});
		
		$.each({
			prev: {traverse: 'prevAll',get: 'last', reverse: true}, 
			next: {traverse: 'nextAll', get: 'first'}
		}, function(name, val){
			webshims.Grid.prototype[name] = function(){
				var sel = 'button:not(:disabled,.othermonth)';
				var button = this.activeButton.closest('td')[val.traverse]('td');
				if(val.reverse){
					button = $(button.get().reverse());
				}
				button = button.find(sel)[val.get]();
				if(!button[0]){
					button = this.activeButton.closest('tr')[val.traverse]('tr');
					if(val.reverse){
						button = $(button.get().reverse());
					}
					button = button.find(sel)[val.get]();
				}
				
				if(!button[0]){
					if(this.opts[name]){
						this.popover.navedInitFocus = val.get;
						this.popover.actionFn(this.opts[name]);
						this.popover.navedInitFocus = false;
					}
				} else {
					this.setFocus(button.eq(0));
				}
			};
		});
		
		picker.getWeek = function(date){
			var onejan = new Date(date.getFullYear(),0,1);
			return Math.ceil((((date - onejan) / 86400000) + onejan.getDay()+1)/7);
		};
		picker.getYearList = function(value, data){
			var j, i, val, disabled, lis, prevDisabled, nextDisabled, classStr, classArray, start;
			
			
			var size = data.options.size;
			var max = data.options.max.split('-');
			var min = data.options.min.split('-');
			var currentValue = data.options.value.split('-');
			var xthCorrect = 0;
			var enabled = 0;
			var str = '';
			var rowNum = 0;
			
			if(data.options.useDecadeBase == 'max' && max[0]){
				xthCorrect = 11 - (max[0] % 12);
			} else if(data.options.useDecadeBase == 'min' && min[0]){
				xthCorrect = 11 - (min[0] % 12);
			}
			
			value = value[0] * 1;
			start = value - ((value + xthCorrect) % (12 * size));
			
			
			
			for(j = 0; j < size; j++){
				if(j){
					start += 12;
				}  else {
					prevDisabled = picker.isInRange([start-1], max, min) ? {'data-action': 'setYearList','value': start-1} : false;
				}
				
				str += '<div class="year-list picker-list ws-index-'+ j +'"><div class="ws-picker-header"><button disabled="disabled">'+ start +' – '+(start + 11)+'</button></div>';
				lis = [];
				for(i = 0; i < 12; i++){
					val = start + i ;
					classArray = [];
					if( !picker.isInRange([val], max, min) ){
						disabled = ' disabled=""';
					} else {
						disabled = '';
						enabled++;
					}
					
					if(val == today[0]){
						classArray.push('this-value');
					}
					
					if(currentValue[0] == val){
						classArray.push('checked-value');
					}
					
					classStr = classArray.length ? ' class="'+ (classArray.join(' ')) +'"' : '';
					
					if(i && !(i % 3)){
						rowNum++;
						lis.push('</tr><tr class="ws-row-'+ rowNum +'">');
					}
					lis.push('<td class="ws-item-'+ i +'" role="presentation"><button  data-id="year-'+ i +'" type="button"'+ disabled + classStr +' data-action="setMonthList" value="'+val+'" tabindex="-1" role="gridcell">'+val+'</button></td>');
				}
				if(j == size - 1){
					nextDisabled = picker.isInRange([val+1], max, min) ? {'data-action': 'setYearList','value': val+1} : false;
				}
				str += '<div class="picker-grid"><table role="grid" aria-label="'+ start +' – '+(start + 11)+'"><tbody><tr class="ws-row-0">'+ (lis.join(''))+ '</tr></tbody></table></div></div>';
			}
			
			return {
				enabled: enabled,
				main: str,
				next: nextDisabled,
				prev: prevDisabled,
				type: 'Grid'
			};
		};
		
		
		picker.getMonthList = function(value, data){
			
			var j, i, name, val, disabled, lis, fullyDisabled, prevDisabled, nextDisabled, classStr, classArray;
			var o = data.options;
			var size = o.size;
			var max = o.max.split('-');
			var min = o.min.split('-');
			var currentValue = o.value.split('-');
			var enabled = 0;
			var rowNum = 0;
			var str = '';
			
			value = value[0] - Math.floor((size - 1) / 2);
			for(j = 0; j < size; j++){
				if(j){
					value++;
				} else {
					prevDisabled = picker.isInRange([value-1], max, min) ? {'data-action': 'setMonthList','value': value-1} : false;
				}
				if(j == size - 1){
					nextDisabled = picker.isInRange([value+1], max, min) ? {'data-action': 'setMonthList','value': value+1} : false;
				}
				lis = [];
				
				if( !picker.isInRange([value, '01'], max, min) && !picker.isInRange([value, '12'], max, min)){
					disabled = ' disabled=""';
					fullyDisabled = true;
				} else {
					fullyDisabled = false;
					disabled = '';
				}
				
				if(o.minView >= 1){
					disabled = ' disabled=""';
				}
				
				str += '<div class="month-list picker-list ws-index-'+ j +'"><div class="ws-picker-header">';
				
				str += o.selectNav ? 
					'<select data-action="setMonthList" class="year-select">'+ picker.createYearSelect(value, max, min).join('') +'</select>' : 
					'<button data-action="setYearList"'+disabled+' value="'+ value +'" tabindex="-1">'+ value +'</button>';
				str += '</div>';
				
				for(i = 0; i < 12; i++){
					val = curCfg.date.monthkeys[i+1];
					name = (curCfg.date[o.monthNames] || curCfg.date.monthNames)[i];
					classArray = [];
					if(fullyDisabled || !picker.isInRange([value, val], max, min) ){
						disabled = ' disabled=""';
					} else {
						disabled = '';
						enabled++;
					}
					
					if(value == today[0] && today[1] == val){
						classArray.push('this-value');
					}
					
					if(currentValue[0] == value && currentValue[1] == val){
						classArray.push('checked-value');
					}
					
					classStr = (classArray.length) ? ' class="'+ (classArray.join(' ')) +'"' : '';
					if(i && !(i % 3)){
						rowNum++;
						lis.push('</tr><tr class="ws-row-'+ rowNum +'">');
					}

					lis.push('<td class="ws-item-'+ i +'" role="presentation"><button data-id="month-'+ i +'" type="button"'+ disabled + classStr +' data-action="'+ (data.type == 'month' ? 'changeInput' : 'setDayList' ) +'" value="'+value+'-'+val+'" tabindex="-1" role="gridcell" aria-label="'+ curCfg.date.monthNames[i] +'">'+name+'</button></td>');
					
				}
				
				str += '<div class="picker-grid"><table role="grid" aria-label="'+value+'"><tbody><tr class="ws-row-0">'+ (lis.join(''))+ '</tr></tbody></table></div></div>';
			}
			
			return {
				enabled: enabled,
				main: str,
				prev: prevDisabled,
				next: nextDisabled,
				type: 'Grid'
			};
		};
		
		
		picker.getDayList = function(value, data){
			
			var j, i, k, day, nDay, name, val, disabled, lis,  prevDisabled, nextDisabled, addTr, week, rowNum;
			
			var lastMotnh, curMonth, otherMonth, dateArray, monthName, fullMonthName, buttonStr, date2, classArray;
			var o = data.options;
			var size = o.size;
			var max = o.max.split('-');
			var min = o.min.split('-');
			var currentValue = o.value.split('-');
			var monthNames = curCfg.date[o.monthNamesHead] || curCfg.date[o.monthNames] || curCfg.date.monthNames; 
			var enabled = 0;
			var str = [];
			var date = new Date(value[0], value[1] - 1, 1);
			
			date.setMonth(date.getMonth()  - Math.floor((size - 1) / 2));
			
			for(j = 0;  j < size; j++){
				date.setDate(1);
				lastMotnh = date.getMonth();
				rowNum = 0;
				if(!j){
					date2 = new Date(date.getTime());
					date2.setDate(-1);
					dateArray = getDateArray(date2);
					prevDisabled = picker.isInRange(dateArray, max, min) ? {'data-action': 'setDayList','value': dateArray[0]+'-'+dateArray[1]} : false;
				}
				
				dateArray = getDateArray(date);
				
				str.push('<div class="day-list picker-list ws-index-'+ j +'"><div class="ws-picker-header">');
				if( o.selectNav ){
					monthName = ['<select data-action="setDayList" class="month-select" tabindex="0">'+ picker.createMonthSelect(dateArray, max, min, monthNames).join('') +'</select>', '<select data-action="setDayList" class="year-select" tabindex="0">'+ picker.createYearSelect(dateArray[0], max, min, '-'+dateArray[1]).join('') +'</select>'];
					if(curCfg.date.showMonthAfterYear){
						monthName.reverse();
					}
					str.push( monthName.join(' ') );
				} 
				
				fullMonthName = [curCfg.date.monthNames[(dateArray[1] * 1) - 1], dateArray[0]];
				monthName = [monthNames[(dateArray[1] * 1) - 1], dateArray[0]];
				if(curCfg.date.showMonthAfterYear){
					monthName.reverse();
					fullMonthName.reverse();
				}
				
				if(!data.options.selectNav) {
					str.push(  
						'<button data-action="setMonthList"'+ (o.minView >= 2 ? ' disabled="" ' : '') +' value="'+ dateArray.date +'" tabindex="-1">'+ monthName.join(' ') +'</button>'
					);
				}
				
				
				str.push('</div><div class="picker-grid"><table role="grid" aria-label="'+ fullMonthName.join(' ')  +'"><thead><tr>');
				
				if(data.options.showWeek){
					str.push('<th class="week-header">'+ curCfg.date.weekHeader +'</th>');
				}
				for(k = curCfg.date.firstDay; k < curCfg.date.dayNamesShort.length; k++){
					str.push('<th class="day-'+ k +'"><abbr title="'+ curCfg.date.dayNames[k] +'">'+ curCfg.date.dayNamesShort[k] +'</abbr></th>');
				}
				k = curCfg.date.firstDay;
				while(k--){
					str.push('<th class="day-'+ k +'"><abbr title="'+ curCfg.date.dayNames[k] +'">'+ curCfg.date.dayNamesShort[k] +'</abbr></th>');
				}
				str.push('</tr></thead><tbody><tr class="ws-row-0">');
				
				if(data.options.showWeek) {
					week = picker.getWeek(date);
					str.push('<td class="week-cell">'+ week +'</td>');
				}
				
				for (i = 0; i < 99; i++) {
					addTr = (i && !(i % 7));
					curMonth = date.getMonth();
					otherMonth = lastMotnh != curMonth;
					day = date.getDay();
					classArray = [];
					
					if(addTr && otherMonth ){
						str.push('</tr>');
						break;
					}
					if(addTr){
						rowNum++;
						str.push('</tr><tr class="ws-row-'+ rowNum +'">');
						if(data.options.showWeek) {
							week++;
							str.push('<td class="week-cell">'+ week +'</td>');
						}
					}
					
					if(!i){
						
						if(day != curCfg.date.firstDay){
							nDay = day - curCfg.date.firstDay;
							if(nDay < 0){
								nDay += 7;
							}
							date.setDate(date.getDate() - nDay);
							day = date.getDay();
							curMonth = date.getMonth();
							otherMonth = lastMotnh != curMonth;
						}
					}
					
					dateArray = getDateArray(date);
					buttonStr = '<td role="presentation" class="day-'+ day +'"><button data-id="day-'+ date.getDate() +'" role="gridcell" data-action="changeInput" value="'+ (dateArray.join('-')) +'"';
					
					if(otherMonth){
						classArray.push('othermonth');
					} else {
						classArray.push('day-'+date.getDate());
					}
					
					if(dateArray[0] == today[0] && today[1] == dateArray[1] && today[2] == dateArray[2]){
						classArray.push('this-value');
					}
					
					if(currentValue[0] == dateArray[0] && dateArray[1] == currentValue[1] && dateArray[2] == currentValue[2]){
						classArray.push('checked-value');
					}
					
					if(classArray.length){
						buttonStr += ' class="'+ classArray.join(' ') +'"';
					}
					
					if(!picker.isInRange(dateArray, max, min) || (data.options.disableDays && $.inArray(day, data.options.disableDays) != -1)){
						buttonStr += ' disabled=""';
					}
					
					str.push(buttonStr+' tabindex="-1">'+ date.getDate() +'</button></td>');
					
					date.setDate(date.getDate() + 1);
				}
				str.push('</tbody></table></div></div>');
				if(j == size - 1){
					dateArray = getDateArray(date);
					dateArray[2] = 1;
					nextDisabled = picker.isInRange(dateArray, max, min) ? {'data-action': 'setDayList','value': dateArray.date} : false;
				}
			}
					
			
			return {
				enabled: 9,
				main: str.join(''),
				prev: prevDisabled,
				next: nextDisabled,
				type: 'Grid'
			};
		};
		
		picker.isInRange = function(values, max, min){
			var i;
			var ret = true;
			for(i = 0; i < values.length; i++){
				
				if(min[i] && min[i] > values[i]){
					ret = false;
					break;
				} else if( !(min[i] && min[i] == values[i]) ){
					break;
				}
			}
			if(ret){
				for(i = 0; i < values.length; i++){
					
					if((max[i] && max[i] < values[i])){
						ret = false;
						break;
					} else if( !(max[i] && max[i] == values[i]) ){
						break;
					}
				}
			}
			return ret;
		};
		
		picker.createMonthSelect = function(value, max, min, monthNames){
			if(!monthNames){
				monthNames = curCfg.date.monthNames;
			}
			
			var selected;
			var i = 0;
			var options = [];
			var tempVal = value[1]-1;
			for(; i < monthNames.length; i++){
				selected = tempVal == i ? ' selected=""' : '';
				if(selected || picker.isInRange([value[0], i+1], max, min)){
					options.push('<option value="'+ value[0]+'-'+addZero(i+1) + '"'+selected+'>'+ monthNames[i] +'</option>');
				}
			}
			return options;
		};
		
		picker.createYearSelect = function(value, max, min, valueAdd){
			
			var temp;
			var goUp = true;
			var goDown = true;
			var options = ['<option selected="">'+ value + '</option>'];
			var i = 0;
			if(!valueAdd){
				valueAdd = '';
			}
			while(i < 8 && (goUp || goDown)){
				i++;
				temp = value-i;
				if(goUp && picker.isInRange([temp], max, min)){
					options.unshift('<option value="'+ (temp+valueAdd) +'">'+ temp +'</option>');
				} else {
					goUp = false;
				}
				temp = value + i;
				if(goDown && picker.isInRange([temp], max, min)){
					options.push('<option value="'+ (temp+valueAdd) +'">'+ temp +'</option>');
				} else {
					goDown = false;
				}
			}
			return options;
		};
			
		var actions = {
			changeInput: function(val, popover, data){
				popover.stopOpen = true;
				data.element.getShadowFocusElement().focus();
				setTimeout(function(){
					popover.stopOpen = false;
				}, 9);
				popover.hide();
				data.setChange(val);
			}
		};
		
		(function(){
			var retNames = function(name){
				return 'get'+name+'List';
			};
			var retSetNames = function(name){
				return 'set'+name+'List';
			};
			var stops = {
				date: 'Day',
				week: 'Day',
				month: 'Month'
			};
			
			$.each({'setYearList' : ['Year', 'Month', 'Day'], 'setMonthList': ['Month', 'Day'], 'setDayList': ['Day']}, function(setName, names){
				var getNames = names.map(retNames);
				var setNames = names.map(retSetNames);
				actions[setName] = function(val, popover, data, startAt){
					val = ''+val;
					var o = data.options;
					var values = val.split('-');
					if(!startAt){
						startAt = 0;
					}
					$.each(getNames, function(i, item){
						if(i >= startAt){
							var content = picker[item](values, data);
							
							if( values.length < 2 || content.enabled > 1 || stops[data.type] === names[i]){
								popover.element
									.attr({'data-currentview': setNames[i]})
									.addClass('ws-size-'+o.size)
									.data('pickercontent', {
										data: data,
										content: content,
										values: values
									})
								;
								popover.bodyElement.html(content.main);
								if(content.prev){
									popover.prevElement
										.attr(content.prev)
										.prop({disabled: false})
									;
								} else {
									popover.prevElement
										.removeAttr('data-action')
										.prop({disabled: true})
									;
								}
								if(content.next){
									popover.nextElement
										.attr(content.next)
										.prop({disabled: false})
									;
								} else {
									popover.nextElement
										.removeAttr('data-action')
										.prop({disabled: true})
									;
								}
								if(webshims[content.type]){
									new webshims[content.type](popover.bodyElement.children(), popover, content);
								}
								popover.element.trigger('pickerchange');
								return false;
							}
						}
					});
				};
			});
		})();
		
		picker.commonInit = function(data, popover){
			var actionfn = function(e){
				if(!$(this).is('.othermonth') || $(this).css('cursor') == 'pointer'){
					popover.actionFn({
						'data-action': $.attr(this, 'data-action'),
						value: $(this).val() || $.attr(this, 'value')
					});
				}
				return false;
			};
			var id = new Date().getTime();
			var generateList = function(o, max, min){
				var options = [];
				var label = '';
				var labelId = '';
				o.options = data.getOptions() || {};
				$('div.ws-options', popover.contentElement).remove();
				$.each(o.options[0], function(val, label){
					var disabled = picker.isInRange(val.split('-'), o.maxS, o.minS) ?
						'' :
						' disabled="" '
					;
					options.push('<li role="presentation"><button value="'+ val +'" '+disabled+' data-action="changeInput" tabindex="-1"  role="option">'+ (label || data.formatValue(val, false)) +'</button></li>');
				});
				if(options.length){
					id++;
					if(o.options[1]){
						labelId = 'datalist-'+id;
						label = '<h5 id="'+labelId+'">'+ o.options[1] +'</h5>';
						labelId = ' aria-labelledbyid="'+ labelId +'" ';
					}
					new webshims.ListBox($('<div class="ws-options">'+label+'<ul role="listbox" '+ labelId +'>'+ options.join('') +'</div>').insertAfter(popover.bodyElement)[0], popover, {noFocus: true});
				}
			};
			var updateContent = function(){
				if(popover.isDirty){
					var o = data.options;
					o.maxS = o.max.split('-');
					o.minS = o.min.split('-');
					
					$('button', popover.buttonRow).each(function(){
						var text;
						if($(this).is('.ws-empty')){
							text = curCfg.date.clear;
							if(!text){
								text = formcfg[''].date.clear || 'clear';
								webshims.warn("could not get clear text from form cfg");
							}
						} else if($(this).is('.ws-current')){
							text = (curCfg[data.type] || {}).currentText;
							if(!text){
								text = (formcfg[''][[data.type]] || {}).currentText || 'current';
								webshims.warn("could not get currentText from form cfg");
							}
							$.prop(this, 'disabled', !picker.isInRange(today[data.type].split('-'), o.maxS, o.minS));
						}
						if(text){
							$(this).text(text).attr({'aria-label': text});
							if(webshims.assumeARIA){
								$.attr(this, 'aria-label', text);
							}
						}
						
					});
					popover.nextElement.attr({'aria-label': curCfg.date.nextText});
					$('> span', popover.nextElement).html(curCfg.date.nextText);
					popover.prevElement.attr({'aria-label': curCfg.date.prevText});
					$('> span', popover.prevElement).html(curCfg.date.prevText);
					
					generateList(o, o.maxS, o.minS);
					
				}
				$('button.ws-empty', popover.buttonRow).prop('disabled', $.prop(data.orig, 'required'));
				popover.isDirty = false;
			};
			
			popover.actionFn = function(obj){
				if(actions[obj['data-action']]){
					actions[obj['data-action']](obj.value, popover, data, 0);
				} else {
					webshims.warn('no action for '+ obj['data-action']);
				}
			};
			
			popover.contentElement.html('<button class="ws-prev" tabindex="0"><span></span></button> <button class="ws-next" tabindex="0"><span></span></button><div class="ws-picker-body"></div><div class="ws-button-row"><button type="button" class="ws-current" data-action="changeInput" value="'+today[data.type]+'" tabindex="0"></button> <button type="button" data-action="changeInput" value="" class="ws-empty" tabindex="0"></button></div>');
			popover.nextElement = $('button.ws-next', popover.contentElement);
			popover.prevElement = $('button.ws-prev', popover.contentElement);
			popover.bodyElement = $('div.ws-picker-body', popover.contentElement);
			popover.buttonRow = $('div.ws-button-row', popover.contentElement);
			
			popover.isDirty = true;
			
			popover.contentElement
				.on('click', 'button[data-action]', actionfn)
				.on('change', 'select[data-action]', actionfn)
			;
			
			popover.contentElement.on({
				keydown: function(e){
					if(e.keyCode == 9){
						var tabbable = $('[tabindex="0"]:not(:disabled)', this).filter(':visible');
						var index = tabbable.index(e.target);
						if(e.shiftKey && index <= 0){
							tabbable.last().focus();
							return false;
						}
						if(!e.shiftKey && index >= tabbable.length - 1){
							tabbable.first().focus();
							return false;
						}
					} else if(e.keyCode == 27){
						data.element.getShadowFocusElement().focus();
						popover.hide();
						return false;
					}
				}
			});
			
			$(data.options.orig).on('input', function(){
				var currentView;
				if(data.options.updateOnInput && popover.isVisible && data.options.value && (currentView = popover.element.attr('data-currentview'))){
					actions[currentView]( data.options.value , popover, data, 0);
				}
			});
			
			data._propertyChange = (function(){
				var timer;
				var update = function(){
					if(popover.isVisible){
						updateContent();
					}
				};
				return function(prop){
					if(prop == 'value'){return;}
					popover.isDirty = true;
					if(popover.isVisible){
						clearTimeout(timer);
						timer = setTimeout(update, 9);
					}
				};
			})();
			
			popover.activeElement = $([]);
			
			popover.activateElement = function(element){
				element = $(element);
				if(element[0] != popover.activeElement[0]){
					popover.activeElement.removeClass('ws-focus');
					element.addClass('ws-focus');
				}
				popover.activeElement = element;
			};
			popover.element.on({
				wspopoverbeforeshow: function(){
					data.element.triggerHandler('wsupdatevalue');
					updateContent();
				}
			});
			
			$(document).onTrigger('wslocalechange', data._propertyChange);
			$(data.orig).on('remove', function(e){
				if(!e.originalEvent){
					$(document).off('wslocalechange', data._propertyChange);
					popover.element.remove();
				}
			});
		};
		
		picker._common = function(data){
			var popover = webshims.objectCreate(webshims.wsPopover, {}, {prepareFor: data.element});
			var opener = $('<button type="button" class="ws-popover-opener"><span /></button>').appendTo(data.buttonWrapper);
			var options = data.options;
			var init = false;
			
			var show = function(){
				if(!options.disabled && !options.readonly && !popover.isVisible){
					if(!init){
						picker.commonInit(data, popover);
					}
					
					if(!init || data.options.restartView) {
						actions.setYearList( options.defValue || options.value, popover, data, data.options.startView);
					} else {
						actions[popover.element.attr('data-currentview') || 'setYearList']( options.defValue || options.value, popover, data, 0);
					}
					
					init = true;
					popover.show(data.element);
				}
			};
			
			options.containerElements.push(popover.element[0]);
			
			if(!options.startView){
				options.startView = 0;
			}
			if(!options.minView){
				options.minView = 0;
			}
			if(options.startView < options.minView){
				options.minView = options.startView;
				webshims.warn("wrong config for minView/startView.");
			}
			if(!options.size){
				options.size = 1;
			}
			
			popover.element
				.addClass(data.type+'-popover input-picker')
				.attr({role: 'application'})
				.on({
					wspopoverhide: function(){
						popover.openedByFocus = false;
					},
					focusin: function(e){
						if(popover.activateElement){
							popover.openedByFocus = false;
							popover.activateElement(e.target);
						}
					},
					focusout: function(){
						if(popover.activeElement){
							popover.activeElement.removeClass('ws-focus');
						}
					}
				})
			;
			
			labelWidth(popover.element.children('div.ws-po-outerbox').attr({role: 'group'}), options.labels, true);
			labelWidth(opener, options.labels, true);
			
			if(options.tabindex != null){
				opener.attr({tabindex: options.tabindex});
			}
			
			if(options.disabled){
				opener.prop({disabled: true});
			}
			opener
				
				.on({
					mousedown: function(){
						stopPropagation.apply(this, arguments);
						popover.preventBlur();
					},
					click: function(){
						if(popover.isVisible && popover.activeElement){
							popover.openedByFocus = false;
							popover.activeElement.focus();
						}
						show();
					},
					focus: function(){
						popover.preventBlur();
					}
				})
			;
			
			(function(){
				var mouseFocus = false;
				var resetMouseFocus = function(){
					mouseFocus = false;
				};
				data.inputElements.on({
					focus: function(){
						if(!popover.stopOpen && (data.options.openOnFocus || (mouseFocus && options.openOnMouseFocus))){
							popover.openedByFocus = !options.noInput;
							show();
						} else {
							popover.preventBlur();
						}
					},
					mousedown: function(){
						mouseFocus = true;
						setTimeout(resetMouseFocus, 9);
						if(data.element.is(':focus')){
							popover.openedByFocus = !options.noInput;
							show();
						}
						popover.preventBlur();
					}
				});
			})();
			data.popover = popover;
		};
		
		picker.month = picker._common;
		picker.date = picker.month;
		
		webshims.picker = picker;
	})();
	
	(function(){
		
		var stopCircular, isCheckValidity;
		
		var modernizrInputTypes = Modernizr.inputtypes;
		var inputTypes = {
			
		};
		var copyProps = [
			'disabled',
			'readonly',
			'value',
			'min',
			'max',
			'step',
			'title',
			'placeholder'
		];
		
		//
		var copyAttrs = ['data-placeholder', 'tabindex'];
			
		$.each(copyProps.concat(copyAttrs), function(i, name){
			var fnName = name.replace(/^data\-/, '');
			webshims.onNodeNamesPropertyModify('input', name, function(val){
				if(!stopCircular){
					var shadowData = webshims.data(this, 'shadowData');
					if(shadowData && shadowData.data && shadowData.nativeElement === this && shadowData.data[fnName]){
						shadowData.data[fnName](val);
					}
				}
			});
		});
		
		if(options.replaceUI && 'valueAsNumber' in document.createElement('input')){
			var reflectFn = function(val){
				if(webshims.data(this, 'hasShadow')){
					$.prop(this, 'value', $.prop(this, 'value'));
				}
			};
			
			webshims.onNodeNamesPropertyModify('input', 'valueAsNumber', reflectFn);
			webshims.onNodeNamesPropertyModify('input', 'valueAsDate', reflectFn);
		}
		
		var extendType = (function(){
			return function(name, data){
				inputTypes[name] = data;
				data.attrs = $.merge([], copyAttrs, data.attrs);
				data.props = $.merge([], copyProps, data.props);
			};
		})();
		
		var isVisible = function(){
			return $.css(this, 'display') != 'none';
		};
		var sizeInput = function(data){
			var init;
			var updateStyles = function(){
				$(data.orig).removeClass('ws-important-hide');
				$.style( data.orig, 'display', '' );
				var hasButtons, marginR, marginL;
				var correctWidth = 0.6;
				if(!init || data.orig.offsetWidth){
					hasButtons = data.buttonWrapper && data.buttonWrapper.filter(isVisible).length;
					marginR = $.css( data.orig, 'marginRight');
					data.element.css({
						marginLeft: $.css( data.orig, 'marginLeft'),
						marginRight: hasButtons ? 0 : marginR
					});
					
					if(hasButtons){
						marginL = (parseInt(data.buttonWrapper.css('marginLeft'), 10) || 0);
						data.element.css({paddingRight: ''});
						
						if(marginL < 0){
							marginR = (parseInt(marginR, 10) || 0) + ((data.buttonWrapper.outerWidth() + marginL) * -1);
							data.buttonWrapper.css('marginRight', marginR);
							data.element
								.css({paddingRight: ''})
								.css({
									paddingRight: (parseInt( data.element.css('paddingRight'), 10) || 0) + data.buttonWrapper.outerWidth()
								})
							;
						} else {
							data.buttonWrapper.css('marginRight', marginR);
							correctWidth = data.buttonWrapper.outerWidth(true) + 0.6;
						}
					}
					
					data.element.outerWidth( $(data.orig).outerWidth() - correctWidth );
				}
				init = true;
				$(data.orig).addClass('ws-important-hide');
			};
			data.element.onWSOff('updateshadowdom', updateStyles, true);
		};
		
		
		var implementType = function(){
			var type = $.prop(this, 'type');
			
			var i, opts, data, optsName, labels;
			if(inputTypes[type] && webshims.implement(this, 'inputwidgets')){
				data = {};
				optsName = type;
				
				//todo: do we need deep extend?
				
				labels = $(this).jProp('labels');
				
				opts = $.extend({}, options.widgets, options[type], $($.prop(this, 'form')).data(type) || {}, $(this).data(type) || {}, {
					orig: this,
					type: type,
					labels: labels,
					options: {},
					input: function(val){
						opts._change(val, 'input');
					},
					change: function(val){
						opts._change(val, 'change');
					},
					_change: function(val, trigger){
						stopCircular = true;
						$.prop(opts.orig, 'value', val);
						stopCircular = false;
						if(trigger){
							$(opts.orig).trigger(trigger);
						}
					},
					containerElements: []
				});
				
				
				for(i = 0; i < copyProps.length; i++){
					opts[copyProps[i]] = $.prop(this, copyProps[i]);
				}
				
				for(i = 0; i < copyAttrs.length; i++){
					optsName = copyAttrs[i].replace(/^data\-/, '');
					if(optsName == 'placeholder' || !opts[optsName]){
						opts[optsName] = $.attr(this, copyAttrs[i]) || opts[optsName];
					}
				}
				
				data.shim = inputTypes[type]._create(opts);
				
				webshims.addShadowDom(this, data.shim.element, {
					data: data.shim || {}
				});
				
				data.shim.options.containerElements.push(data.shim.element[0]);
				
				labelWidth($(this).getShadowFocusElement(), labels);
				$.attr(this, 'required', $.attr(this, 'required'));
				$(this).on('change', function(e){
					if(!stopCircular){
						data.shim.value($.prop(this, 'value'));
					}
				});
				
				(function(){
					var has = {
						focusin: true,
						focus: true
					};
					var timer;
					var hasFocusTriggered = false;
					var hasFocus = false;
					
					$(data.shim.options.containerElements)
						.on({
							'focusin focus focusout blur': function(e){
								e.stopImmediatePropagation();
								hasFocus = has[e.type];
								clearTimeout(timer);
								timer = setTimeout(function(){
									if(hasFocus != hasFocusTriggered){
										hasFocusTriggered = hasFocus;
										$(opts.orig).triggerHandler(hasFocus ? 'focus' : 'blur');
										$(opts.orig).trigger(hasFocus ? 'focusin' : 'focusout');
									}
									hasFocusTriggered = hasFocus;
								}, 0);
							}
						})
					;
				})();
								
				
				data.shim.element.on('change input', stopPropagation);
				
				if(Modernizr.formvalidation){
					$(opts.orig).on('firstinvalid', function(e){
						if(!webshims.fromSubmit && isCheckValidity){return;}
						$(opts.orig).off('invalid.replacedwidgetbubble').on('invalid.replacedwidgetbubble', function(evt){
							if(!e.isInvalidUIPrevented() && !evt.isDefaultPrevented()){
								webshims.validityAlert.showFor( e.target );
								e.preventDefault();
								evt.preventDefault();
							}
							$(opts.orig).off('invalid.replacedwidgetbubble');
						});
					});
				}
				
				
				if(data.shim.buttonWrapper && data.shim.buttonWrapper.filter(isVisible).length){
					data.shim.element.addClass('has-input-buttons');
				}
				
				if(opts.calculateWidth){
					sizeInput(data.shim);
				} else {
					$(this).css({display: 'none'});
				}
			}
		};
		
		if(!modernizrInputTypes.range || options.replaceUI){
			extendType('range', {
				_create: function(opts, set){
					return $('<span />').insertAfter(opts.orig).rangeUI(opts).data('rangeUi');
				}
			});
		}
		
		if(Modernizr.formvalidation){
			['input', 'form'].forEach(function(name){
				var desc = webshims.defineNodeNameProperty(name, 'checkValidity', {
					prop: {
						value: function(){
							isCheckValidity = true;
							var ret = desc.prop._supvalue.apply(this, arguments);
							isCheckValidity = false;
							return ret;
						}
					}
				});
			});
		}
		
		var isStupid = navigator.userAgent.indexOf('MSIE 10.0') != -1 && navigator.userAgent.indexOf('Touch') == -1;
		['number', 'time', 'month', 'date'].forEach(function(name){
			if(!modernizrInputTypes[name] || options.replaceUI || (name == 'number' && isStupid)){
				extendType(name, {
					_create: function(opts, set){
						
						if(opts.splitInput && !splitInputs[name]){
							webshims.warn('splitInput not supported for '+ name);
							opts.splitInput = false;
						}
						var markup = opts.splitInput ?
								'<span class="ws-'+name+' ws-input" role="group"></span>' :
								'<input class="ws-'+name+'" type="text" />';
						var data = $(markup) //role="spinbutton"???
							.insertAfter(opts.orig)
							.spinbtnUI(opts)
							.data('wsspinner')
						;
						if(webshims.picker && webshims.picker[name]){
							webshims.picker[name](data);
						}
						data.buttonWrapper.addClass('input-button-size-'+(data.buttonWrapper.children().filter(isVisible).length));
						return data;
					}
				});
			}
		});
		
		
		webshims.addReady(function(context, contextElem){
			$('input', context)
				.add(contextElem.filter('input'))
				.each(implementType)
			;
		});
	})();
});

