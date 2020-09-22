/*
 * Copyright 2014-2015 Quantiply Corporation. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
define([
  'angular',
  'lodash',
  'app/core/utils/datemath',
  'moment',
],
function (angular, _, dateMath, moment) {
  'use strict';

  /** @ngInject */
  function DruidDatasource(instanceSettings, $q, backendSrv, templateSrv, timeSrv) {

    this.type = 'druid-datasource';
    this.url = instanceSettings.url;
    this.name = instanceSettings.name;
    this.basicAuth = instanceSettings.basicAuth;
    this.adhocFilterDS = instanceSettings.jsonData.adhocFilterDS;
    this.dsRegex = instanceSettings.jsonData.dsRegex;
    instanceSettings.jsonData = instanceSettings.jsonData || {};
    this.supportMetrics = true;
    this.periodGranularity = instanceSettings.jsonData.periodGranularity;

    function replaceTemplateValues(obj,scopedVars, attrList) {
      if (obj.type === 'in') {
        var substitutedVals = _.chain(attrList)
          .map(attr => { return templateSrv.replace(obj[attr]).replace(/[{}]/g, "") })
          .map(val => { return val.split(',') })
          .flatten().value();
        substitutedVals = [substitutedVals];
      } else {
        var substitutedVals = attrList.map(function (attr) {
          return templateSrv.replace(obj[attr],scopedVars);
        });
      }
      return _.assign(_.clone(obj, true), _.zipObject(attrList, substitutedVals));
    }

    var GRANULARITIES = [
      ['second', moment.duration(1, 'second')],
      ['minute', moment.duration(1, 'minute')],
      ['five_minute', moment.duration(5, 'minute')],
      ['fifteen_minute', moment.duration(15, 'minute')],
      ['thirty_minute', moment.duration(30, 'minute')],
      ['hour', moment.duration(1, 'hour')],
      ['day', moment.duration(1, 'day')],
      ['week', moment.duration(1, 'week')],
      ['month', moment.duration(1, 'month')],
      ['quarter', moment.duration(1, 'quarter')],
      ['year', moment.duration(1, 'year')]
    ];

    var filterTemplateExpanders = {
      "selector": _.partialRight(replaceTemplateValues, ['value']),
      "regex": _.partialRight(replaceTemplateValues, ['pattern']),
      "javascript": _.partialRight(replaceTemplateValues, ['function']),
      "search": _.partialRight(replaceTemplateValues, []),
      "in": _.partialRight(replaceTemplateValues, ['values']),
      "json": _.partialRight(replaceTemplateValues, ['value'])
    };

    var aggregationTemplateExpanders = {
      "count": _.partialRight(replaceTemplateValues, ['name']),
      "cardinality": _.partialRight(replaceTemplateValues, ['fieldNames']),
      "longSum": _.partialRight(replaceTemplateValues, ['fieldName']),
      "doubleSum": _.partialRight(replaceTemplateValues, ['fieldName']),
      "doubleMax": _.partialRight(replaceTemplateValues, ['fieldName']),
      "doubleMin": _.partialRight(replaceTemplateValues, ['fieldName']),
      "approxHistogramFold": _.partialRight(replaceTemplateValues, ['fieldName']),
      "hyperUnique": _.partialRight(replaceTemplateValues, ['fieldName']),
      "json": _.partialRight(replaceTemplateValues, ['value']),
      "thetaSketch": _.partialRight(replaceTemplateValues, ['fieldName'])
    };

    this.testDatasource = function() {
      return this._get('/druid/v2/datasources').then(function () {
        return { status: "success", message: "Druid Data source is working", title: "Success" };
      });
    };

    //Get list of available datasources
    this.getDataSources = function() {
      // var regex = new RegExp(this.dsRegex, 'ig' ); 
      var regex = eval(this.dsRegex); 
      return this._get('/druid/v2/datasources').then(function (response) {
        // var datasources = response.data;
        var results =  regex ? _.filter(response.data, datasource => {return regex.test(datasource)}) : response.data;
        return results;
      });

    };

    this.getDimensionsAndMetrics = function (datasource) {
      return this._get('/druid/v2/datasources/'+ datasource).then(function (response) {
        return response.data;
      });
    };

    this.getFilterValues = function (target, panelRange, query) {
        var topNquery = {
            "queryType": "topN",
            "dataSource": target.druidDS,
            "granularity": 'all',
            "threshold": 10,
            "dimension": target.currentFilter.dimension,
            "metric": "count",
            "aggregations": [{ "type" : "count", "name" : "count" }],
            "intervals" : getQueryIntervals(panelRange.from, panelRange.to)
        };

        var filters = [];
        if(target.filters){
            filters = angular.copy(target.filters);
        }
        filters.push({
            "type": "search",
            "dimension": target.currentFilter.dimension,
            "query": {
                "type": "insensitive_contains",
                "value": query
            }
        });
        topNquery.filter = buildFilterTree(filters);

        return this._druidQuery(topNquery);
    };

    this._get = function(relativeUrl, params) {
      return backendSrv.datasourceRequest({
        method: 'GET',
        url: this.url + relativeUrl,
        params: params,
      });
    };

    // Called once per panel (graph)
    this.query = function(options) {
      var dataSource = this;
      var from = dateToMoment(options.range.from, false);
      var to = dateToMoment(options.range.to, true);

      console.log("Do query");
      console.log(options);

      var promises = options.targets.map(function (target) {
        if (target.hide===true || _.isEmpty(target.druidDS) || (_.isEmpty(target.aggregators) && target.queryType !== "scan")) {
          console.log("target.hide: " + target.hide + ", target.druidDS: " + target.druidDS + ", target.aggregators: " + target.aggregators);
          var d = $q.defer();
          d.resolve([]);
          return d.promise;
        }
        var maxDataPointsByResolution = options.maxDataPoints;
        var maxDataPointsByConfig = target.maxDataPoints? target.maxDataPoints : Number.MAX_VALUE;
        var maxDataPoints = Math.min(maxDataPointsByResolution, maxDataPointsByConfig);
        var granularity = target.shouldOverrideGranularity? templateSrv.replace(target.customGranularity) : computeGranularity(from, to, maxDataPoints);
        //Round up to start of an interval
        //Width of bar chars in Grafana is determined by size of the smallest interval
        var roundedFrom = from;

          var firstChar = granularity.charAt(0);
          if (firstChar >= '1' && firstChar <= '9') {
              granularity = {"type": "period", "period": "PT" + granularity.toUpperCase()}
          } else {
              roundedFrom = granularity === "all" ? from : roundUpStartTime(from, granularity);
          }

        if(granularity==='five_minute'){
            granularity = {"type": "period", "period": "PT5M"}
        }
        if(dataSource.periodGranularity!=""){
            if(granularity==='day'){
                granularity = {"type": "period", "period": "P1D", "timeZone": dataSource.periodGranularity}
            }
        }
        return dataSource._doQuery(roundedFrom, to, granularity, target, options.scopedVars);
      });

      return $q.all(promises).then(function(results) {
        return { data: _.flatten(results) };
      });
    };

    this._doQuery = function (from, to, granularity, target, scopedVars) {

      function splitCardinalityFields(aggregator) {

        if(aggregator.type === 'cardinality' && typeof aggregator.fieldNames === 'string') {
           aggregator.fieldNames = aggregator.fieldNames.split(',')
        }

        //adds support for aggregation template variable
        if(aggregator.type!='count' ){
           aggregator=aggregationTemplateExpanders[aggregator.type](aggregator, scopedVars);
        }

        //adds json type aggregator
        if(aggregator.type === 'json'){
           aggregator= splitCardinalityFields(JSON.parse(aggregator.value))
        }

        return aggregator;
      }

      var datasource = target.druidDS;
      var filters = target.filters;
      var aggregators = target.aggregators && target.aggregators.map(splitCardinalityFields);
      var postAggregators = target.postAggregators;
      var groupBy = _.map(target.groupBy, (e) => { return templateSrv.replace(e) });
      var limitSpec = null;
      var metricNames = getMetricNames(aggregators, postAggregators);
      var intervals = getQueryIntervals(from, to);
      var promise = null;
      var selectDimensions = target.selectDimensions;
      
      var scanColumns = target.scanColumns;


        var postAggs = [];
        if (postAggregators && postAggregators.length) {
            var len = postAggregators.length;
            for (var i = 0; i < len; i++) {
                var agg = _.clone(postAggregators[i]);
                if (agg['function']) {
                    agg['function'] = templateSrv.replace(agg['function'])
                    postAggs.push(agg);
                } else {
                   postAggs.push(agg);
                }
            }
        }

      if (target.queryType === 'topN') {
        var threshold = target.limit;
        var metric = target.druidMetric;
        var dimension = templateSrv.replace(target.dimension);
        var isTopNQueryForVar = target.isTopNQueryForVar

        if (dimension && dimension.indexOf("{") == 0) {
            dimension = JSON.parse(dimension);
        }

        promise = this._topNQuery(datasource, intervals, granularity, filters, aggregators, postAggs, threshold, metric, dimension, scopedVars, isTopNQueryForVar)
          .then(function(response) {
            // var seriesList = convertTopNData(response.data, dimension['outputName'] || dimension, metric);
            var seriesList = convertTopNData(response.data, dimension['outputName'] || dimension, metricNames);
            return seriesList;
          });
      }
      else if (target.queryType === 'groupBy') {
          groupBy = _.map(selectDimensions, function(one) {
              if (one['outputName']) {
                    return one['outputName'];
              }
              return one;
          });
        limitSpec = getLimitSpec(target.limit, target.orderBy);
        promise = this._groupByQuery(datasource, intervals, granularity, filters, aggregators, postAggs, selectDimensions, limitSpec, scopedVars)
          .then(function(response) {
            return convertGroupByData(response.data, groupBy, metricNames);
          });
      }
      else if(target.queryType === 'scan'){
        promise = this._scanQuery(datasource, intervals, scanColumns, target.limit, filters, scopedVars);
        return promise.then(function(response){
            return convertScanData(response.data);
        });
      }
      else {
        promise = this._timeSeriesQuery(datasource, intervals, granularity, filters, aggregators, postAggs, scopedVars)
          .then(function(response) {
            return convertTimeSeriesData(response.data, metricNames);
          });
      }
      /*
        At this point the promise will return an list of time series of this form
      [
        {
          target: <metric name>,
          datapoints: [
            [<metric value>, <timestamp in ms>],
            ...
          ]
        },
        ...
      ]

      Druid calculates metrics based on the intervals specified in the query but returns a timestamp rounded down.
      We need to adjust the first timestamp in each time series
      */
      return promise.then(function (metrics) {
        var fromMs = formatTimestamp(from);
        metrics.forEach(function (metric) {
          if (!_.isEmpty(metric.datapoints[0]) && metric.datapoints[0][1] < fromMs) {
            metric.datapoints[0][1] = fromMs;
          }
        });
        return metrics;
      });
    };

    this._scanQuery = function (datasource, intervals, columns, limit, filters, scopedVars){
      if(isNaN(limit)){
        limit = 1000;
      }else if(limit > 2000){
        limit = 2000;
      }

      var query = {
        "queryType": "scan",
        "dataSource": datasource,
        "legacy": true,
        "resultFormat": "compactedList",
        "columns": columns,
        "limit": limit,
        "intervals": intervals
      }

      query.filter = buildFilterTree(filters, scopedVars);
      return this._druidQuery(query);
    };

    this._timeSeriesQuery = function (datasource, intervals, granularity, filters, aggregators, postAggregators, scopedVars) {
      var query = {
        "queryType": "timeseries",
        "dataSource": datasource,
        "granularity": granularity,
        "aggregations": aggregators,
        "postAggregations": postAggregators,
        "intervals": intervals
      };

      query.filter = buildFilterTree(filters, scopedVars);

      return this._druidQuery(query);
    };

    this._topNQuery = function (datasource, intervals, granularity, filters, aggregators, postAggregators,
    threshold, metric, dimension, scopedVars, isTopNQueryForVar) {
      var query = {
        "queryType": "topN",
        "dataSource": datasource,
        "granularity": granularity,
        "threshold": threshold,
        "dimension": dimension,
        "metric": metric,
        // "metric": {type: "inverted", metric: metric},
        "aggregations": aggregators,
        "postAggregations": postAggregators,
        "intervals": intervals
      };

      query.filter = isTopNQueryForVar ? null : buildFilterTree(filters, scopedVars);

      return this._druidQuery(query);
    };

    this._groupByQuery = function (datasource, intervals, granularity, filters, aggregators, postAggregators,
    groupBy, limitSpec, scopedVars) {
      var query = {
        "queryType": "groupBy",
        "dataSource": datasource,
        "granularity": granularity,
        "dimensions": groupBy,
        "aggregations": aggregators,
        "postAggregations": postAggregators,
        "intervals": intervals,
        "limitSpec": limitSpec
      };

      query.filter = buildFilterTree(filters, scopedVars);

      return this._druidQuery(query);
    };

    this._druidQuery = function (query) {
      var options = {
        method: 'POST',
        url: this.url + '/druid/v2/',
        data: query
      };
      console.log("Make http request");
      console.log(options);
      return backendSrv.datasourceRequest(options);
    };

      /** Variable query action.
       *  It is invoked by /public/app/features/templating/query_variable.getOptions() lie in grafana server endpoint.
       *  For more details refer to https://grafana.com/docs/grafana/latest/packages_api/data/datasourceapi/#metricfindquery-method
       */          
      this.metricFindQuery = function(query) {
        var range = angular.element('grafana-app').injector().get('timeSrv').timeRangeForUrl();
        var from = dateToMoment(range.from, false);
        var to = dateToMoment(range.to, true);
        var intervals = getQueryIntervals(from, to);

        var params = query.split(":");
        for(var i =0; i < params.length; i++) {
            params[i] = templateSrv.replace(params[i]);
        }
        if (params[1] == 'dimensions') {
            return this._get('/druid/v2/datasources/' + params[0]).then(function (response) {
                var dimensions = _.map(response.data.dimensions, function (e) {
                    return { "text": e };
                });
                dimensions.unshift({ "text": "-" });
                return dimensions;
            });
        } else if (params[1] == 'metrics') {
            return this._get('/druid/v2/datasources/' + params[0]).then(function (response) {
                var metrics = _.map(response.data.metrics, function (e) {
                    return { "text": e };
                });
                metrics.unshift({ "text": "-" });
                return metrics;
            });
        } else {
        return this._topNQueryForVar(params[0], params[1]);
      }
    }
      
    function getLimitSpec(limitNum, orderBy) {
      return {
        "type": "default",
        "limit": limitNum,
        "columns": !orderBy? null: orderBy.map(function (col) {
          return {"dimension": col, "direction": "DESCENDING"};
        })
      };
    }

    function buildFilterTree(filters, scopedVars) {
      //Do template variable replacement
        var adhocFilters = getAdhocFilters();
        if ((!filters || filters.length == 0) && (!adhocFilters || adhocFilters.length == 0)) {
            return null;
        }
        console.log(adhocFilters);
        var targetFilters = [];
        if (filters) {
            filters.forEach(function(one) {
              targetFilters.push(one);
            });
        }
        for (var n = 0; n < adhocFilters.length; n++) {
            var f = adhocFilters[n];
            var filter = {};
            filter['type'] = 'selector';
            filter['dimension'] = f['key'];
            filter['value'] = f['value'];
            if (f['operator'] == '!=') {
                filter['negate'] = true;
            }
            targetFilters.push(filter);
        }
        
      var replacedFilters = targetFilters.map(function (filter) {
        return filterTemplateExpanders[filter.type](filter, scopedVars);
      })
      .map(function (filter) {
        var finalFilter = _.omit(filter, 'negate');
        if (filter.negate) {
          return { "type": "not", "field": finalFilter };
        }
        if (filter.type === "json") {
          finalFilter = JSON.parse(filter.value);
        }
        return finalFilter;
      });

      if (replacedFilters) {
        replacedFilters = remove_filter_recursively(replacedFilters)
      }

      if (replacedFilters.length>0) {
        if (replacedFilters.length === 1) {
          return replacedFilters[0];
        }
        return  {
          "type": "and",
          "fields": replacedFilters
        };
      }

      return null;
    }

    function remove_filter_recursively(filters){

      return filters.map(function(filter){
        if(filter.fields) {
          filter.fields=remove_filter_recursively(filter.fields)
        }
        return filter
      }).filter(function(filter){
        if (filter.pattern)
          return filter.pattern != "_REMOVE_FILTER_"
        else if (filter.value)
          return filter.value != "_REMOVE_FILTER_"
        else if (filter.values)
          return !filter.values.includes("_REMOVE_FILTER_")
        else
          return true
      });

    }

    function getQueryIntervals(from, to) {
      return [from.toISOString() + '/' + to.toISOString()];
    }

    function getMetricNames(aggregators, postAggregators) {
      var displayAggs = _.filter(aggregators, function (agg) {
        return agg.type !== 'approxHistogramFold' && agg.hidden != true;
      });
      return _.union(_.map(displayAggs, 'name'), _.map(postAggregators, 'name'));
    }

    function formatTimestamp(ts) {
      return moment(ts).format('X')*1000;
    }

    function convertTimeSeriesData(md, metrics) {
      return metrics.map(function (metric) {
        return {
          target: metric,
          datapoints: md.map(function (item) {
            return [
              item.result[metric],
              formatTimestamp(item.timestamp)
            ];
          })
        };
      });
    }

    function getGroupName(groupBy, metric) {
      return groupBy.map(function (dim) {
        return metric.event[dim];
      })
      .join("-");
    }

    function convertTopNData(md, dimension, metrics) {

      var dVals = md.reduce(function (dValsSoFar, tsItem) {
        var dValsForTs = _.map(tsItem.result, dimension);
        return _.union(dValsSoFar, dValsForTs);
      }, {});

      md.forEach(function (tsItem) {
        var dValsPresent = _.map(tsItem.result, dimension);
        var dValsMissing = _.difference(dVals, dValsPresent);
        dValsMissing.forEach(function (dVal) {
          var nullPoint = {};
          nullPoint[dimension] = dVal;
          metrics.forEach(function(metric){
            nullPoint[metric] = null;
          });
          // nullPoint[metric] = null;
          tsItem.result.push(nullPoint);
        });
        return tsItem;
      });

      //Re-index the results by dimension value instead of time interval
      var mergedData;
      
      if(metrics.length < 2){

        mergedData = md.map(function (item) {
          var timestamp = formatTimestamp(item.timestamp);
          var keys = _.map(item.result, dimension);
          var vals = _.map(item.result, metrics[0]).map(function (val) { return [val, timestamp];});
          return _.zipObject(keys, vals);
        })
        .reduce(function (prev, curr) {

          return _.assignWith(prev, curr, function (pVal, cVal) {
            if (pVal) {
              pVal.push(cVal);
              return pVal;
            }
            return [cVal];
          });
        }, {});

      }else{



        metrics.forEach(function(metric){

          var partMergedData = md.map(function (item) {
            var timestamp = formatTimestamp(item.timestamp);
            var keys = _.map(item.result, dimension).map(function(key) {return key + ":" + metric});
            var vals = _.map(item.result, metric).map(function (val) { return [val, timestamp];});
            return _.zipObject(keys, vals);
          })
          .reduce(function (prev, curr) {
  
            return _.assignWith(prev, curr, function (pVal, cVal) {
              if (pVal) {
                pVal.push(cVal);
                return pVal;
              }
              return [cVal];
            });
          }, {});

          mergedData.push(partMergedData);

        });

/**         
        mergedData = md.map(function(item) {
          var zipObjects = [];
          var timestamp = formatTimestamp(item.timestamp);
          metrics.map(function(metric){
            var keys = _.map(item.result, dimension).map(function(key) {return key + ":" + metric});
            var vals = _.map(item.result, metric).map(function (val) { return [val, timestamp];});
            zipObjects.push(_.zipObject(keys, vals));
          })
          return _.flatten(zipObjects).value();
        })
        .reduce(function (prev, curr) {

          return _.assignWith(prev, curr, function (pVal, cVal) {
            if (pVal) {
              pVal.push(cVal);
              return pVal;
            }
            return [cVal];
          });
        }, {});
*/
      }


      return _.map(mergedData, function (vals, key) {
          return {
            target: key,
            datapoints: vals
          };
        });



    }

    function convertGroupByData(md, groupBy, metrics) {
      var mergedData = md.map(function (item) {
        /*
          The first map() transforms the list Druid events into a list of objects
          with keys of the form "<groupName>:<metric>" and values
          of the form [metricValue, unixTime]
        */
        var groupName = getGroupName(groupBy, item);
        var keys = metrics.map(function (metric) {
          return groupName + ":" + metric;
        });
        var vals = metrics.map(function (metric) {
          return [
            item.event[metric],
            formatTimestamp(item.timestamp)
          ];
        });
        return _.zipObject(keys, vals);
      })
      .reduce(function (prev, curr) {
        /*
          Reduce() collapses all of the mapped objects into a single
          object.  The keys are still of the form "<groupName>:<metric>"
          and the values are arrays of all the values for the same key.
          The _.assign() function merges objects together and it's callback
          gets invoked for every key,value pair in the source (2nd argument).
          Since our initial value for reduce() is an empty object,
          the _.assign() callback will get called for every new val
          that we add to the final object.
        */
        return _.assignWith(prev, curr, function (pVal, cVal) {
          if (pVal) {
            pVal.push(cVal);
            return pVal;
          }
          return [cVal];
        });
      }, {});

      return _.map(mergedData, function (vals, key) {
        /*
          Second map converts the aggregated object into an array
        */
        return {
          target: key,
          datapoints: vals
        };
      });
    }

    function convertScanData(data){
      var results = [];
      for(var i = 0; i < data.length; i++){
        results[i] = {"columns": [], "rows": [], "type": "table"};
    
        var columns = data[i].columns.map( columnName => {return {"text": columnName}});
        columns.splice(0, 1, {
            "text": "Time",
            "type": "time",
            "sort": true,
            "desc": true
          });
    
        results[i].columns =columns;
    
        results[i].rows = data[i].events;
      }

      return results;
    }

    function dateToMoment(date, roundUp) {
      if (date === 'now') {
        return moment();
      }
      date = dateMath.parse(date, roundUp);
      return moment(date.valueOf());
    }

    function computeGranularity(from, to, maxDataPoints) {
      var intervalSecs = to.unix() - from.unix();
      /*
        Find the smallest granularity for which there
        will be fewer than maxDataPoints
      */
      var granularityEntry = _.find(GRANULARITIES, function(gEntry) {
        return Math.ceil(intervalSecs/gEntry[1].asSeconds()) <= maxDataPoints;
      });

      console.log("Calculated \"" + granularityEntry[0]  +  "\" granularity [" + Math.ceil(intervalSecs/granularityEntry[1].asSeconds()) +
      " pts]" + " for " + (intervalSecs/60).toFixed(0) + " minutes and max of " + maxDataPoints + " data points");
      return granularityEntry[0];
    }

    function roundUpStartTime(from, granularity) {
      var duration = _.find(GRANULARITIES, function (gEntry) {
        return gEntry[0] === granularity;
      })[1];
      var rounded = null;
      if(granularity==='day'){
        rounded = moment(+from).startOf('day');
      }else{
        rounded = moment(Math.ceil((+from)/(+duration)) * (+duration));
      }
      console.log("Rounding up start time from " + from.format() + " to " + rounded.format() + " for granularity [" + granularity + "]");
      return rounded;
    }

      // add by wujj
      function getAdhocFilters() {
        let filters = [];
        var datasourceName = instanceSettings.name;
        if (templateSrv.variables) {
          for (let i = 0; i < templateSrv.variables.length; i++) {
            const variable = templateSrv.variables[i];
            if (variable.type !== 'adhoc') {
              continue;
            }
    
            // null is the "default" datasource
            if (variable.datasource === null || variable.datasource === datasourceName) {
              filters = filters.concat(variable.filters);
            } else if (variable.datasource.indexOf('$') === 0) {
              if (this.replace(variable.datasource) === datasourceName) {
                filters = filters.concat(variable.filters);
              }
            }
          }
        }
    
        return filters;
      }

    /** Get tag keys for adhoc filters. 
     *  It is invoked by /public/app/features/dashboard/components/AdHocFilters/AdHocFiltersCtr.getOptions() lie in grafana server endpoint.
     *  For more details refer to https://grafana.com/docs/grafana/latest/packages_api/data/datasourceapi/#gettagkeys-method 
     *  Add by xuzh1 on 2020/08/14   
     */
    this.getTagKeys = function(){
      return this.getDimensionsAndMetrics(this.adhocFilterDS).then(result => {
        var fields = [].concat(result.metrics).concat(result.dimensions);
        return _.map(fields, fieldName => {return {"text": fieldName}});
      });
    }


    /** Get tag values for adhoc filters. 
     *  It is invoked by /public/app/features/dashboard/components/AdHocFilters/AdHocFiltersCtr.getOptions() lie in grafana server endpoint.
     *  For more details refer to https://grafana.com/docs/grafana/latest/packages_api/data/datasourceapi/#gettagvalues-method
     *  Add by xuzh1 on 2020/08/14   
     */
    this.getTagValues = function(options){
      return this._topNQueryForVar(this.adhocFilterDS, options.key);

    }           

    /** It is used to get tag values for adhoc filters and variables.
     *  Add by xuzh1 on 2020/08/14   
     */    
    this._topNQueryForVar = function(datasource, dimension){
      var range = timeSrv.timeRange();
      var from = moment(Number(range.from.valueOf().toString()));
      var to = moment(Number(range.to.valueOf().toString()));

      var metric = "count";
      var target = {
          "queryType": "topN",
          "druidDS": datasource,
          "dimension": dimension,
          "druidMetric": metric,
          "aggregators": [{"type": "count", "name": metric}],
          "limit": 250,
          "isTopNQueryForVar": true
      };

      var promise = this._doQuery(from, to, 'all', target);
      return promise.then(results => {
          var l = _.map(results, (e) => {
              return {"text": e.target};
          });
          l.unshift({"text": "-"});
          return l;
      });
    }


   //changes druid end
  }
  return {
    DruidDatasource: DruidDatasource
  };
});
