var instanceSetting = {
  id: 5,
  jsonData: {
    keepCookies: [],
    tlsAuth: false,
    tlsAuthWithCACert: false,
    tlsSkipVerify: false,
  },
  meta: {
    alerting: false,
    annotations: true,
    baseUrl: "public/plugins/grafana-server-datasource",
    dependencies: {
      grafanaVersion: "3.x.x",
      plugins: [],
    },
    id: "grafana-server-datasource",
    includes: null,
    info: {
      author: {
        name:"liuchunhui",
        url:"https://grafana.com",
      },
      description: "代理服务端作为数据源",
      links: [
        {name: "Github", url: ""},
        {name: "MIT License", url: ""}
      ],
      logos: {
        large:"public/plugins/grafana-server-datasource/img/server-logo.png",
        small:"public/plugins/grafana-server-datasource/img/server-logo.png"
      },
     screenshots:null,
     updated:"2018-04-23",
     version:"1.0.0"
    },
    metrics: true,
   module: "plugins/grafana-server-datasource/module",
   name: "代理服务端",
   routes: null,
   type: "datasource",
  },
  name:"代理服务端数据源",
  type:"grafana-server-datasource",
  url:"/api/datasources/proxy/5",
}

