///<reference path="../headers/common.d.ts" />

import angular from 'angular';
import _ from 'lodash';

export class DruidConfigCtrl {
  static templateUrl = 'partials/config.html';
  current: any;
  listDataSources: any;
  datasource: any;

  
  constructor($scope) {
    // this.current.jsonData.adhocFilterDS = this.current.jsonData.adhocFilterDS;
    // this.current.jsonData.periodGranularity = this.current.jsonData.periodGranularity;    

    // needs to be defined here as it is called from typeahead
    this.listDataSources = (query, callback) => {
      this.datasource.getDataSources()
      .then(callback);
    };

  }




}
