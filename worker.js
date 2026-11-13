// Cloudflare Worker: シンプルなWebプロキシ
const KEY = ""; // ← 合言葉を必ず設定

export default {
  async fetch(req) {
    const me = new URL(req.url);
    if (!KEY || me.searchParams.get("key") !== KEY)
      return new Response("forbidden", { status: 403 });
    let target;
    try { target = new URL(me.searchParams.get("url")); }
    catch (e) { return new Response("url が不正です", { status: 400 }); }
    if (target.protocol !== "http:" && target.protocol !== "https:")
      return new Response("http/https のみ対応", { status: 400 });

    const wrap = (u) => {
      try {
        const abs = new URL(u, target).href;
        if (!/^https?:/.test(abs)) return u;
        return me.origin + "/?key=" + encodeURIComponent(KEY) + "&url=" + encodeURIComponent(abs);
      } catch (e) { return u; }
    };

    const res = await fetch(target, {
      method: req.method,
      headers: { "user-agent": req.headers.get("user-agent") || "", "accept-language": req.headers.get("accept-language") || "" },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
      redirect: "manual"
    });

    const h = new Headers(res.headers);
    ["content-security-policy", "content-security-policy-report-only", "x-frame-options", "set-cookie"].forEach((k) => h.delete(k));
    if (h.get("location")) h.set("location", wrap(h.get("location")));

    const out = new Response(res.body, { status: res.status, headers: h });
    if (!(h.get("content-type") || "").includes("text/html")) return out;

    const rw = (attr) => ({ element(el) { const v = el.getAttribute(attr); if (v) el.setAttribute(attr, wrap(v)); } });
    return new HTMLRewriter()
      .on("a", rw("href")).on("link", rw("href")).on("form", rw("action"))
      .on("img", rw("src")).on("script", rw("src")).on("iframe", rw("src")).on("source", rw("src"))
      .transform(out);
  }
};
