var templateSrv = {
  builtIns: {
    __interval:{text: "1s", value: "1s"},
    __interval_ms:{text: "100", value: "100"}
  },
  grafanaVariables: {},
  index:{},
  regex:/\$(\w+)|\[\[([\s\S]+?)(?::(\w+))?\]\]|\${(\w+)(?::(\w+))?}/g
}
