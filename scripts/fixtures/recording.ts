import type { Express } from "express";

// Only mounted by the isolated recording regression runner, never by the app.
export function installRecordingFixture(app: Express) {
  app.get("/fixture/devices", (_req, res) =>
    res.json({ code: 0, data: [{ name: "井下环境监测终端" }] }),
  );
  app.post("/fixture/login", (_req, res) =>
    res.json({ code: 0, token: "fixture-token-for-redaction" }),
  );
  app.post("/fixture/devices", (_req, res) =>
    res.json({ code: 0, message: "测试设备保存成功" }),
  );
  app.get("/fixture/failure", (_req, res) =>
    res.status(500).json({ code: 500, message: "验证接口故障" }),
  );
  app.get("/fixture/alarms", (_req, res) => res.json({ code: 0, data: [] }));
  app.get("/fixture/recording", (_req, res) =>
    res.type("html").send(`<!doctype html><html lang="zh-CN">
<meta charset="UTF-8"><title>录制回归夹具</title>
<nav aria-label="模块菜单"><button id="devices-menu" aria-current="page">设备台账</button><button id="alarms-menu">历史告警</button></nav>
<section id="login-panel"><label>账号<input id="username" value="tester"></label><label>密码<input id="password" type="password"></label><button id="login">登录</button></section>
<h1 id="heading">设备台账</h1>
<section id="device-panel"><label>设备名称<input id="search"></label><button id="query">查询</button><button id="new-device">新增设备</button><button id="fault">接口异常</button><button id="console-fault">前端异常</button><button id="native-confirm">原生确认测试</button><table><tbody id="rows"></tbody></table></section>
<section id="alarm-panel" hidden><button id="alarm-query">查询告警</button></section>
<div id="toast" role="status"></div>
<dialog id="editor"><label>设备名称<input id="device-name"></label><button id="save-device">保存</button></dialog>
<script>
const $ = id => document.getElementById(id);
const notice = text => $('toast').textContent = text;
async function devices() {
  const result = await fetch('/fixture/devices?name=' + encodeURIComponent($('search').value)).then(r => r.json());
  $('rows').replaceChildren(...result.data.map(v => {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = v.name; tr.append(td); return tr;
  }));
  notice('设备列表加载完成');
}
$('query').onclick = devices;
$('login').onclick = async () => {
  await fetch('/fixture/login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: $('username').value, password: $('password').value}) });
  $('login-panel').hidden = true;
};
function modulePage(alarms) {
  $('device-panel').hidden = alarms; $('alarm-panel').hidden = !alarms;
  $('heading').textContent = alarms ? '历史告警' : '设备台账';
  $(alarms ? 'devices-menu' : 'alarms-menu').removeAttribute('aria-current');
  $(alarms ? 'alarms-menu' : 'devices-menu').setAttribute('aria-current', 'page');
}
$('devices-menu').onclick = () => modulePage(false);
$('alarms-menu').onclick = () => modulePage(true);
$('new-device').onclick = () => $('editor').showModal();
$('save-device').onclick = async () => {
  const result = await fetch('/fixture/devices', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: $('device-name').value}) }).then(r => r.json());
  $('editor').close(); notice(result.message);
};
$('fault').onclick = async () => { await fetch('/fixture/failure'); notice('接口故障'); };
$('console-fault').onclick = () => { console.error('验证前端错误'); setTimeout(() => { throw new Error('验证页面异常'); }, 10); };
$('native-confirm').onclick = () => { if (confirm('确认测试操作？')) notice('确认操作已执行'); };
$('alarm-query').onclick = async () => { await fetch('/fixture/alarms'); notice('告警查询完成'); };
devices();
</script></html>`),
  );
}
