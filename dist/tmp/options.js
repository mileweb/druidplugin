//parameter for datasource.query

var options = {
  "range": {
     "from": moment,  // 全局时间筛选起始日期
     "raw": {from: "now-7d", to: "now"},
     "to": moment,  // 全局时间筛选结束日期
  },
   "rangeRaw": {
     "from": "now-7d",
     "to": "now",
   },
  "interval": "15m",
   "intervalMs": 900000,
  "targets": [{  // 定义的查询条件们
     "refId": "A",
     "target": "upper_75" 
  }, {
     "refId": "B", 
     "target": "upper_90" 
  }],
  "format": "json",
  "maxDataPoints": 2495, //decided by the panel
   "cacheTimeout": undefined,
   "panelId": 2,
   "timezone": "browser"
}


