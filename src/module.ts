// import {DruidDatasource} from './datasource';
// import {DruidQueryCtrl} from './query_ctrl';
// import {DruidConfigCtrl} from './config_ctrl';

// export {
//   DruidDatasource as Datasource,
//   DruidQueryCtrl as QueryCtrl,
//   DruidConfigCtrl as ConfigCtrl
// };

import { DataSourcePlugin } from '@grafana/data';
import DruidDatasource from './datasource';
import {DruidQueryCtrl} from './query_ctrl';
import {DruidConfigCtrl} from './config_ctrl';

class DruidAnnotationsQueryCtrl {
  static templateUrl = 'partials/annotations.editor.html';
}

export const plugin = new DataSourcePlugin(DruidDatasource)
.setQueryCtrl(DruidQueryCtrl)
.setConfigEditor(DruidConfigCtrl)
.setAnnotationQueryCtrl(DruidAnnotationsQueryCtrl);




