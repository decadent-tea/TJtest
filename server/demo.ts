import type { Express } from "express";
export function installDemo(app: Express) {
  app.get("/demo/api/devices", (_req, res) =>
    res.json({
      code: 0,
      data: [
        {
          id: "BD-001",
          name: "井下环境监测终端",
          area: "一号井 / 运输巷",
          state: "在线",
        },
        {
          id: "BD-002",
          name: "矿用视频采集终端",
          area: "二号井 / 工作面",
          state: "在线",
        },
        {
          id: "BD-003",
          name: "智能皮带控制器",
          area: "一号井 / 主运皮带",
          state: "离线",
        },
      ],
    }),
  );
  app.get("/demo/api/alarms", (_req, res) =>
    res.json({
      code: 0,
      data: [
        {
          name: "设备离线告警",
          time: new Date().toLocaleString("zh-CN"),
          level: "提示",
        },
      ],
    }),
  );
  app.post("/demo/api/login", (_req, res) =>
    res.json({
      code: 0,
      token: "demo-token-for-redaction",
      message: "登录成功",
    }),
  );
  app.post("/demo/api/devices", (_req, res) =>
    res.json({
      code: 0,
      message: "测试设备保存成功",
      data: { id: "TEST-" + Date.now() },
    }),
  );
  app.get("/demo/api/failure", (_req, res) =>
    res.status(500).json({ code: 500, message: "演示：设备状态服务不可用" }),
  );
  app.get("/demo/api/export", (_req, res) =>
    res
      .setHeader("Content-Disposition", 'attachment; filename="alarms.csv"')
      .type("text/csv")
      .send("\uFEFF名称,等级\n设备离线告警,提示"),
  );
  app.get("/demo", (_req, res) =>
    res.type("html")
      .send(`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>北斗天地 · 演示业务工程</title><style>*{box-sizing:border-box}body{margin:0;font-family:system-ui;color:#223248;background:#f5f7fb}header{padding:18px 30px;background:#142539;color:white}nav{display:flex;gap:12px;padding:20px 30px;background:white;border-bottom:1px solid #dce2eb}main{max-width:1050px;padding:32px;margin:auto}button{padding:10px 18px;border:1px solid #cbd5e1;background:white;border-radius:7px;cursor:pointer}button:hover{background:#e9f3ff}button[aria-current]{background:#dceeff}input{padding:11px;border:1px solid #cbd5e1;border-radius:6px;margin:8px}table{width:100%;background:white;border-collapse:collapse;margin-top:20px}td,th{text-align:left;border-bottom:1px solid #e6eaf0;padding:18px}.panel{padding:26px;background:white;border:1px solid #dce2eb;border-radius:12px;margin:20px 0}#toast{margin-top:20px;color:#176147}dialog{border:1px solid #cbd5e1;border-radius:12px;padding:32px;min-width:400px}dialog::backdrop{background:#152a4555}</style><header>北斗天地股份有限公司　/　智能化系统演示工程</header><nav aria-label="模块菜单"><button id="devices-menu" aria-current="page">设备台账</button><button id="alarms-menu">历史告警</button></nav><main><section id="login-panel" class="panel"><h2>测试账号登录</h2><label>账号<input id="username" placeholder="测试账号" value="tester"></label><label>密码<input id="password" placeholder="测试密码" type="password"></label><button id="login">登录</button><p>演示工程，使用任意账号密码。不连接实际生产系统。</p></section><h1 id="heading">设备台账</h1><section id="device-panel"><div class="panel"><label>设备名称<input id="search" placeholder="输入设备名称"></label><button id="query">查询</button> <button id="new-device">新增设备</button> <button id="fault">模拟接口异常</button> <button id="console-fault">模拟前端异常</button> <button id="native-confirm">原生确认测试</button></div><table><thead><tr><th>设备编号</th><th>设备名称</th><th>位置</th><th>状态</th></tr></thead><tbody id="rows"></tbody></table></section><section id="alarm-panel" hidden><div class="panel"><button id="alarm-query">查询告警</button> <button id="export">导出告警</button></div><div id="alarm-data"></div></section><div id="toast" role="status"></div></main><dialog id="editor"><h2>新增设备</h2><label>设备名称<input id="device-name" placeholder="测试设备名称"></label><p><button id="save-device">保存</button> <button id="cancel-device">取消</button></p></dialog><script>
const $=id=>document.getElementById(id);const notice=t=>$('toast').textContent=t;
async function devices(){const result=await fetch('/demo/api/devices?name='+encodeURIComponent($('search').value)).then(r=>r.json());$('rows').replaceChildren(...result.data.map(v=>{const tr=document.createElement('tr');[v.id,v.name,v.area,v.state].forEach(text=>{const td=document.createElement('td');td.textContent=text;tr.append(td)});return tr}));notice('设备列表加载完成')}
$('query').onclick=devices;$('login').onclick=async()=>{await fetch('/demo/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('username').value,password:$('password').value})});$('login-panel').hidden=true;notice('登录成功')};
$('devices-menu').onclick=()=>{$('device-panel').hidden=false;$('alarm-panel').hidden=true;$('heading').textContent='设备台账';$('devices-menu').setAttribute('aria-current','page');$('alarms-menu').removeAttribute('aria-current');devices()};
$('alarms-menu').onclick=()=>{$('device-panel').hidden=true;$('alarm-panel').hidden=false;$('heading').textContent='历史告警';$('alarms-menu').setAttribute('aria-current','page');$('devices-menu').removeAttribute('aria-current');notice('')};
$('new-device').onclick=()=>$('editor').showModal();$('cancel-device').onclick=()=>$('editor').close();$('save-device').onclick=async()=>{const r=await fetch('/demo/api/devices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('device-name').value})}).then(r=>r.json());$('editor').close();notice(r.message)};
$('fault').onclick=async()=>{const r=await fetch('/demo/api/failure');notice('演示请求返回 '+r.status);console.warn('设备状态加载失败，请检查状态服务')};$('console-fault').onclick=()=>{console.error('演示：设备模块前端错误');setTimeout(()=>{throw new Error('演示：设备状态组件渲染异常')},10)};
$('alarm-query').onclick=async()=>{const r=await fetch('/demo/api/alarms').then(r=>r.json());$('alarm-data').textContent=r.data.map(v=>v.name+' · '+v.time).join(', ');notice('告警查询完成')};$('export').onclick=()=>{const a=document.createElement('a');a.href='/demo/api/export';a.download='alarms.csv';a.click()};document.getElementById('native-confirm').onclick=()=>{if(confirm('确认测试操作？'))document.getElementById('toast').textContent='确认操作已执行';};devices();
</script></html>`),
  );
}
