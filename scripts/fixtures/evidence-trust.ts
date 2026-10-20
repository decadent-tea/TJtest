import type { Express } from "express";

export function installEvidenceTrustFixture(
  app: Express,
  calls: Map<string, number>,
) {
  app.use("/fixture", (req, _res, next) => {
    calls.set(
      `${req.method} ${req.path}`,
      (calls.get(`${req.method} ${req.path}`) || 0) + 1,
    );
    next();
  });
  app.post("/fixture/login", (_req, res) =>
    res.json({ success: true, code: 200 }),
  );
  app.get("/fixture/data/:id", (_req, res) =>
    res.json({ success: true, data: [] }),
  );
  app.get("/fixture/static.js", (_req, res) => res.type("js").send("void 0"));
  app.get("/fixture/bad.js", (_req, res) => res.status(404).send("missing"));
  app.get("/fixture/page", (_req, res) =>
    res.type("html")
      .send(`<!doctype html><html lang="zh-CN"><title>可信证据夹具</title><button id="login">登录</button><script>
  document.querySelector('#login').onclick=async()=>{
    await fetch('/fixture/login',{method:'POST'});
    await Promise.all(Array.from({length:13},(_,i)=>fetch('/fixture/data/'+i)));
    await fetch('/fixture/static.js'); await fetch('/fixture/bad.js');
    console.error('业务运行时错误保留');document.querySelector('#login').textContent='完成';
  };
  </script></html>`),
  );
}
