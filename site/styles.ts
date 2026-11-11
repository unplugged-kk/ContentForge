/**
 * Stylesheet for the public marketing site (served at /_site/site.css).
 *
 * Kept as a TS string so the same module is used by the dev server (tsx), the
 * production bundle (esbuild) and the static build, with no file-path lookup.
 * Values come from the measured reference capture: see docs/MARKETING_SITE.md.
 */
export const SITE_CSS = String.raw`
:root{
  --bg:#0e0e0e; --fg:#ffffff; --muted:#d1d1d1; --soft:#ffffffcc; --dim:#ffffffe6;
  --card:#1a191999; --card-solid:#1a1919; --line:#ffffff1a; --line-2:#ffffff26;
  --deep:#190b30; --tile:#140c1f; --chip:#3e3e3e; --cta:#8217c3; --pink:#fc69ff;
  --r-xl:32px; --r-lg:30px; --r-md:20px; --r-sm:16px; --pill:9999px;
  --inset:inset 0 0 0 1px rgba(255,255,255,.25);
  --head:"Plus Jakarta Sans",ui-sans-serif,system-ui,sans-serif;
  --body:"DM Sans",ui-sans-serif,system-ui,sans-serif;
  --wrap:1360px;
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--body);font-size:16px;line-height:1.5;overflow-x:hidden;-webkit-font-smoothing:antialiased}
img,svg{display:block}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
h1,h2,h3,h4,p{margin:0}
:focus-visible{outline:2px solid var(--pink);outline-offset:3px;border-radius:6px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.wrap{max-width:var(--wrap);margin:0 auto;padding:0 20px}
.head{font-family:var(--head);font-weight:700;letter-spacing:-.035em}
.center{text-align:center}

/* ---------- buttons ---------- */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:49px;padding:0 24px;border-radius:var(--pill);font-weight:500;font-size:16px;white-space:nowrap;transition:background .2s,color .2s,transform .2s}
.btn-ghost{box-shadow:inset 0 0 0 1px #fff}
.btn-ghost:hover{background:#ffffff14}
.btn-light{background:#fff;color:var(--bg)}
.btn-light:hover{background:#e9e9e9}
.btn-lg{height:57px;padding:0 32px;font-size:19px}
.btn svg{width:24px;height:24px}

/* ---------- header ---------- */
.site-header{position:relative;z-index:50;background:var(--bg);height:81px}
.site-header .wrap{height:81px;display:flex;align-items:center}
.logo{display:flex;align-items:center;gap:8px;height:32px;font-family:var(--head);font-weight:800;font-size:22px;letter-spacing:-.04em}
.logo-mark{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#a855f7,#6d28d9);display:grid;place-items:center;box-shadow:3px 3px 0 #3b0f7a}
.logo-mark svg{width:18px;height:18px}
.main-nav{display:flex;align-items:center;gap:50px;margin-left:167px}
.main-nav>a,.menu>summary{font-size:16px;line-height:21px;display:flex;align-items:center;gap:2px;cursor:pointer;list-style:none}
.menu>summary::-webkit-details-marker{display:none}
.main-nav>a:hover,.menu>summary:hover{color:#ffffffb3}
.menu{position:relative}
.menu>summary svg{width:24px;height:24px;transition:transform .2s}
.menu[open]>summary svg{transform:rotate(180deg)}
.menu-panel{position:absolute;top:44px;left:-24px;min-width:260px;padding:12px;border-radius:var(--r-md);background:#1a1919;box-shadow:var(--inset),0 24px 60px #000a;display:grid;gap:2px}
.menu-panel a{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;font-size:16px}
.menu-panel a:hover{background:#ffffff12}
.menu-panel small{display:block;color:#ffffff99;font-size:13px}
.header-cta{margin-left:auto;display:flex;gap:8px}
.burger{display:none;margin-left:auto;width:40px;height:40px;place-items:center}
.burger svg{width:24px;height:24px}
.mobile-nav{display:none}
.ask svg,.chatbox svg{width:20px;height:20px;flex:none}
.ask .mic svg{width:16px;height:16px}

/* ---------- hero ---------- */
.hero{position:relative;padding:0 20px;margin-top:66px;text-align:center}
.demo-sec{position:relative;padding:60px 20px 0;text-align:center}
.hero-doodle{position:absolute;pointer-events:none}
.hero-doodle.left{left:0;top:265px;width:242px}
.hero-doodle.right{right:0;top:70px;width:136px}
.laurels{display:flex;justify-content:center;gap:16px;height:51px}
.laurel{display:flex;align-items:center;gap:4px;font-size:12px;line-height:12px}
.laurel svg{width:20px;height:51px}
.laurel b{display:block;font-size:19px;line-height:22px;font-weight:700}
.hero h1{max-width:900px;margin:10px auto 0;font-size:70px;line-height:77px}
.rotor{display:inline-flex;align-items:center;gap:14px;vertical-align:top}
.rotor-icon{width:64px;height:64px;border-radius:14px;display:grid;place-items:center;transition:background .4s}
.rotor-icon svg{width:44px;height:44px}
.rotor-word{display:inline-block;transition:opacity .35s,transform .35s}
.rotor-word.out{opacity:0;transform:translateY(12px)}
.hero-sub{max-width:570px;margin:52px auto 0;font-size:22px;line-height:28.6px;color:var(--muted)}
.hero .btn-lg{margin-top:32px}
.channel-strip{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;max-width:600px;margin:30px auto 0}
.toggle-row{display:flex;justify-content:center;align-items:center;gap:8px;margin:25px 0 34px;font-size:16px}
.switch{width:36px;height:20px;border-radius:var(--pill);background:var(--pink);position:relative;transition:background .2s}
.switch::after{content:"";position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .2s}
.switch[aria-checked="true"]{background:#6d5cff}
.switch[aria-checked="true"]::after{transform:translateX(16px)}
.demo{position:relative;margin:0 auto;max-width:1320px;height:700px;border-radius:var(--r-xl) var(--r-xl) 0 0;overflow:hidden;background:radial-gradient(120% 90% at 50% 0%,#5e86ec 0%,#6a3fd6 38%,#592bcd 60%,#a129a9 100%);text-align:left}
.demo-title{padding-top:42px;text-align:center;font-family:var(--head);font-weight:700;font-size:34px;line-height:46px;color:#ffffffe6;letter-spacing:-.02em}
.demo-frame{position:absolute;left:98px;right:98px;top:107px;bottom:-20px;border-radius:var(--r-lg);background:#ffffff33;padding:12px}
.demo-win{height:100%;border-radius:22px;background:#212121;display:grid;grid-template-columns:226px 1fr;overflow:hidden}
.demo-side{background:#181818;padding:26px 22px;font-size:13px;color:#ffffffd9}
.demo-side .brand{display:flex;align-items:center;gap:12px;font-size:26px;font-weight:500;margin-bottom:28px}
.demo-side .brand svg{width:44px;height:44px}
.demo-side p{display:flex;gap:10px;align-items:center;margin:0 0 22px}
.demo-side p svg{width:18px;height:18px}
.bar{height:12px;border-radius:6px;background:#ffffff14;margin:12px 0}
.demo-main{position:relative;padding:28px}
.bubble{position:absolute;right:16px;bottom:126px;max-width:376px;padding:12px 20px;border-radius:12px;background:#303030;font-size:16px;line-height:23px;color:#ffffffe6}
.reply{position:absolute;left:28px;right:28px;bottom:190px;display:none;gap:12px;font-size:14px;color:#ffffffcc}
.reply.on{display:grid;grid-template-columns:repeat(3,1fr)}
.reply .post{padding:12px;border-radius:12px;background:#2a2a2a;box-shadow:var(--inset)}
.reply .post b{display:block;color:#fff;margin-bottom:4px;font-size:13px}
.ask{position:absolute;left:24px;right:16px;bottom:24px;height:46px;border-radius:12px;background:#303030;display:flex;align-items:center;gap:14px;padding:0 18px;color:#ffffff80;font-size:19px}
.ask .mic{margin-left:auto;width:32px;height:32px;border-radius:50%;background:#fff;display:grid;place-items:center;color:#111}
.support{position:absolute;right:20px;top:141px;height:58px;padding:0 16px;border-radius:var(--pill);background:#fff;color:var(--bg);display:flex;align-items:center;gap:10px;font-weight:500;font-size:16px;z-index:5}
.support svg{width:26px;height:26px}

/* ---------- tiles ---------- */
.ch{width:30px;height:30px;border-radius:7px;display:grid;place-items:center;font-weight:800;font-size:13px;line-height:1;font-family:var(--head);letter-spacing:-.03em;flex:none}
.ch svg{width:60%;height:60%}

/* ---------- sections ---------- */
.sec{padding:90px 0}
.sec-title{font-size:48px;line-height:53px;text-align:center}
.sec-sub{max-width:570px;margin:12px auto 0;text-align:center;font-size:22px;line-height:28.6px;color:var(--muted)}
.underline{display:block;margin:4px auto 0;width:320px;height:22px}

/* stats marquee */
.stats-title{font-size:34px;line-height:46px;text-align:center}
.marquee{overflow:hidden;margin-top:50px;-webkit-mask:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent);mask:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)}
.marquee+.marquee{margin-top:12px}
.track{display:flex;gap:12px;width:max-content;animation:slide 60s linear infinite}
.marquee.rev .track{animation-direction:reverse}
@keyframes slide{to{transform:translateX(-50%)}}
.stat{width:270px;height:148px;border-radius:var(--r-md);padding:24px;flex:none}
.stat b{display:block;font-family:var(--head);font-size:34px;line-height:38px;letter-spacing:-.03em}
.stat span{display:block;font-size:18px;line-height:22px;color:#ffffffe6}
.stat em{display:flex;align-items:center;gap:8px;margin-top:16px;font-style:normal;font-size:16px;font-weight:500}
.stat .ch{width:22px;height:22px;font-size:10px;border-radius:5px}

/* who */
.who{padding:120px 0}
.who-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;margin-top:60px}
.who-item{text-align:center}
.who-item svg{width:76px;height:76px;margin:0 auto 24px}
.who-item h3{font-size:30px;line-height:38px}
.who-item p{margin-top:12px;font-size:18px;line-height:28px}

/* in action */
.poster{position:relative;margin:42px 20px 0;height:718px;border-radius:var(--r-md);overflow:hidden;background:radial-gradient(70% 80% at 50% 45%,#2a0a5c 0%,#16062f 60%,#0d0420 100%);box-shadow:0 0 60px #7c3aed66}
.poster-kicker{position:absolute;top:8px;left:0;right:0;text-align:center;font-family:var(--head);font-weight:800;font-size:70px;letter-spacing:.01em}
.poster-big{position:absolute;top:150px;left:0;right:0;text-align:center;font-family:var(--head);font-weight:800;font-size:200px;line-height:1;color:#ffe500;letter-spacing:-.02em;text-shadow:0 8px 0 #0006}
.lifecycle{position:absolute;left:92px;right:92px;bottom:40px;display:grid;grid-template-columns:repeat(8,1fr);gap:12px}
.step{height:120px;border-radius:var(--r-md);background:#ffffff14;box-shadow:var(--inset);padding:14px;display:flex;flex-direction:column;justify-content:space-between;font-size:15px;line-height:19px}
.step i{font-style:normal;font-family:var(--head);font-weight:800;font-size:26px;color:var(--pink)}

/* via cards */
.via-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:60px}
.via{position:relative;min-height:644px;border-radius:var(--r-lg);padding:40px;display:flex;flex-direction:column;overflow:hidden}
.via.flip{justify-content:flex-end}
.via h3{display:flex;align-items:center;gap:12px;font-size:38px;line-height:42px}
.via h3 svg{width:40px;height:40px;flex:none}
.via p{margin-top:16px;font-size:22px;line-height:33px;max-width:560px}
.via .mock{margin-top:auto;height:400px}
.via.flip .mock{margin:0 0 40px}
.via.wide{grid-column:1/-1;min-height:430px;display:grid;grid-template-columns:375px 1fr;gap:40px;align-items:center}
.via.wide h3{font-size:38px;line-height:42px;display:block;margin-top:16px}
.via.wide .mock{height:350px;margin:0}
.mock{border-radius:var(--r-lg);background:#0f0f0f;overflow:hidden;position:relative}
.win{position:absolute;inset:48px 0 0 54px;border-radius:16px 0 0 0;background:#232323;display:grid;grid-template-columns:150px 1fr;font-size:12px;color:#ffffffb3}
.win .side{background:#1b1b1b;padding:18px 16px}
.win .body{position:relative;padding:20px}
.win .msg{position:absolute;right:16px;padding:8px 12px;border-radius:12px;background:#333;max-width:240px;line-height:15px}
.term{position:absolute;inset:50px 0 0 56px;border-radius:12px 0 0 0;background:#232323;font:12px/16px ui-monospace,SFMono-Regular,Menlo,monospace;color:#ffffffd9;padding:36px 18px}
.term .dots{position:absolute;top:10px;left:14px;display:flex;gap:6px}
.dots i{width:10px;height:10px;border-radius:50%;background:#ff5f57}
.dots i:nth-child(2){background:#febc2e}.dots i:nth-child(3){background:#28c840}
.term .box{border:1px dashed #e0713c;padding:12px;color:#e0713c}
.term .box span{color:#fff}
.api{position:absolute;inset:54px 60px 0 60px;border-radius:24px 24px 0 0;background:#232323;box-shadow:var(--inset);padding:28px 24px;font-size:15px}
.api .req{display:flex;align-items:center;margin-top:20px;width:min(468px,100%);height:56px;border-radius:12px;box-shadow:var(--inset)}
.api .req b{width:146px;padding-left:28px;color:#f5a524;font-weight:500;font-size:18px;border-right:1px solid #ffffff1a}
.api .req span{padding-left:32px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.api pre{margin:20px 0 0;color:#ffffffb3;font:13px/20px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}
.g-gpt{background:linear-gradient(160deg,#3b0a6e 0%,#5a0aa8 55%,#7d14d6 100%)}
.g-claude{background:linear-gradient(200deg,#b015b4 0%,#8a0f8f 55%,#6a0b6f 100%)}
.g-code{background:linear-gradient(170deg,#06257d 0%,#0a35a8 55%,#1550e0 100%)}
.g-gem{background:linear-gradient(180deg,#5b2be0 0%,#3e14a8 55%,#2a0a7a 100%)}
.g-open{background:linear-gradient(170deg,#a512a8 0%,#8a0f8f 55%,#5c0a60 100%)}
.g-agent{background:linear-gradient(200deg,#4b0a7a 0%,#7012c4 55%,#5a0aa8 100%)}
.g-api{background:linear-gradient(110deg,#0a2c8c 0%,#0838a5 50%,#1550e0 100%)}

/* tools */
.tools{padding:90px 0}
.tools-grid{display:grid;grid-template-columns:776px 1fr;gap:12px;margin-top:60px}
.tool{position:relative;border-radius:var(--r-lg);padding:40px;min-height:680px;display:flex;flex-direction:column;overflow:hidden;box-shadow:var(--inset)}
.tool .tag{align-self:flex-start;padding:8px 16px;border-radius:var(--pill);background:#ffffff26;font-size:18px;font-weight:500;text-transform:uppercase}
.tool h3{margin-top:20px;font-size:38px;line-height:44px}
.tool p{margin-top:12px;font-size:22px;line-height:28.6px;max-width:560px}
.tool .mock{margin-top:40px;flex:1;min-height:300px}
.tool.full{grid-column:1/-1;display:grid;grid-template-columns:1fr 698px;gap:40px;align-items:center;min-height:566px}
.tool.full .mock{margin:0;height:500px}
.tool.flip .mock{order:-1;margin:0 0 40px}
.tools-grid .r2{display:grid;grid-template-columns:530px 1fr;gap:12px;grid-column:1/-1}
.tools-grid .r2 .tool{min-height:717px}
.t-plan{background:linear-gradient(170deg,#5c0a5c 0%,#8a0f8f 60%,#b015b4 100%)}
.t-agent{background:linear-gradient(200deg,#8a2be0 0%,#6a14c4 55%,#4b0a8a 100%)}
.t-img{background:linear-gradient(110deg,#2a0a6e 0%,#3a0a8a 50%,#5a0ad6 100%)}
.t-team{background:linear-gradient(170deg,#0a1a6e 0%,#14148a 60%,#2a0a8a 100%)}
.t-auto{background:linear-gradient(200deg,#5a2be0 0%,#3e14b4 55%,#2a0a8a 100%)}
.t-an{background:linear-gradient(110deg,#6a0aa8 0%,#4b0a8a 60%,#7012c4 100%)}
.cal{position:absolute;inset:16px 0 0 16px;border-radius:12px 0 0 0;background:#1e1e1e;display:grid;grid-template-columns:62px 164px 1fr;font-size:11px;color:#ffffffcc}
.cal .rail{background:#141414;padding:14px 8px;display:grid;align-content:start;gap:14px;justify-items:center}
.cal .rail i{width:44px;height:30px;border-radius:8px;background:#ffffff14}
.cal .rail i:first-child{background:#fff}
.cal .chs{padding:14px 12px;display:grid;align-content:start;gap:10px}
.cal .chs .b{height:28px;border-radius:6px;background:#2c2c2c;display:grid;place-items:center}
.cal .chs .b.p{background:#612bd3;color:#fff}
.cal .chs .who{display:flex;align-items:center;gap:8px}
.cal .chs .who i{width:20px;height:20px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#ef4444)}
.cal .grid{padding:14px 12px;display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:46px;gap:4px}
.cal .grid div{border-radius:4px;background:#ffffff08;padding:4px;overflow:hidden}
.cal .grid .h{background:#ffffff10;text-align:center}
.cal .grid .ev{background:#3d63e6;color:#fff}
.cal .grid .ev.v{background:#612bd3}
.orbit-mock{position:absolute;inset:0;background:#0f0f0f}
.orbit-mock .ch{position:absolute;width:76px;height:76px;border-radius:18px;font-size:26px}
.chatbox{position:absolute;left:28px;right:28px;bottom:30px;height:50px;border-radius:14px;background:#2a2a2a;display:flex;align-items:center;padding:0 16px;gap:12px;color:#ffffff99;font-size:17px}
.chatbox i{margin-left:auto;width:28px;height:28px;border-radius:50%;background:#fff}
.studio{position:absolute;inset:56px 38px 0;border-radius:8px 8px 0 0;background:#3a3a3a;display:grid;grid-template-rows:52px 1fr}
.studio .top{display:flex;align-items:center;justify-content:space-between;padding:0 12px;font-size:18px;color:#ffffffd9}
.studio .top b{font-size:11px;font-weight:500;padding:8px 12px;border-radius:4px;background:#612bd3;color:#fff}
.studio .canvas{margin:0 12px;background:#fff;display:grid;grid-template-columns:74px 180px 1fr;color:#333;font-size:11px}
.studio .tools-col{display:grid;align-content:start;gap:2px;border-right:1px solid #eee}
.studio .tools-col span{padding:14px 4px;text-align:center}
.studio .tools-col span.on{background:#d9ecf7}
.studio .thumbs{padding:12px;display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:62px;gap:4px;align-content:start;border-right:1px solid #eee}
.studio .thumbs i{border-radius:3px}
.studio .art{margin:20px;border:1px dashed #aaa;display:grid;place-items:center;color:#999}
.team{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.member{width:162px;height:172px;border-radius:16px;background:#2a2a2a;display:grid;justify-items:center;align-content:center;gap:6px;font-size:13px;margin:0 -10px;box-shadow:0 10px 30px #0008}
.member.lead{height:216px;background:#3a3a3a;z-index:1;font-size:16px}
.member i{width:66px;height:66px;border-radius:50%;background:linear-gradient(135deg,#f9a8d4,#a78bfa)}
.member.lead i{width:86px;height:86px;background:linear-gradient(135deg,#fdba74,#f472b6)}
.member b{font-weight:500;font-size:11px;padding:3px 18px;border-radius:999px;background:#c2148a}
.member.lead b{background:#fff;color:#111;font-size:13px;padding:6px 40px}
.member:last-child b{background:#8a14e0}
.feed{position:absolute;inset:28px 0 0 60px;border-radius:16px 0 0 0;background:#1b1b1b;display:grid;grid-template-columns:208px 1fr;font-size:13px}
.feed .nav{padding:20px 30px;display:grid;align-content:start;gap:22px;color:#ffffffd9;font-weight:500}
.feed .post{padding:20px 14px;border-left:1px solid #ffffff14}
.feed .card{margin-top:14px;height:180px;border-radius:16px;background:linear-gradient(135deg,#f3f4f6,#fbcfe8)}
.feed .actions{position:absolute;left:150px;right:0;bottom:12px;height:80px;border-radius:12px 0 0 12px;background:#fff;color:#111;display:flex;align-items:center;justify-content:space-around;font-size:20px;font-weight:500}
.charts{position:absolute;inset:0;padding:60px 0 0 30px;display:grid;grid-template-columns:repeat(3,264px);grid-auto-rows:184px;gap:8px;font-size:15px}
.charts .c{border-radius:6px;background:#232323;padding:12px;display:flex;flex-direction:column;justify-content:space-between}
.charts .c svg{width:100%;height:80px}
.charts .c b{font-size:20px}

/* channels grid */
.tile-rows{margin-top:60px;display:grid;gap:14px;overflow:hidden;padding:0 20px}
.tile-row{display:flex;justify-content:center;gap:14px}
.tile-row:nth-child(2){transform:translateX(-83px)}
.big-tile{width:152px;height:152px;border-radius:var(--r-lg);background:var(--tile);box-shadow:inset 0 0 0 1px #ffffff12;display:grid;place-items:center;flex:none}
.big-tile .ch{width:68px;height:68px;border-radius:14px;font-size:26px}
.big-tile.ghost{opacity:.5}

/* cta band */
.cta-band{border-radius:var(--r-md);background:var(--cta);min-height:246px;padding:60px;display:flex;align-items:center;gap:40px}
.cta-band h3{font-size:48px;line-height:53px}
.cta-band p{margin-top:12px;font-size:22px;line-height:28.6px;max-width:570px}
.cta-band .go{margin-left:auto;display:flex;align-items:center;gap:20px}
.cta-band .go svg{width:92px;height:98px}
.cta-band .btn{height:56px;padding:0 32px;font-size:19px}

/* wall */
.wall-title{display:flex;align-items:center;justify-content:center;gap:12px}
.wall-title svg{width:57px;height:51px}
.wall{columns:3;column-gap:12px;margin-top:60px}
.quote{break-inside:avoid;margin-bottom:12px;border-radius:var(--r-md);background:var(--card);box-shadow:var(--inset);padding:30px 29px;display:block}
.quote p{font-size:18px;line-height:22.5px;white-space:pre-line}
.quote .by{display:flex;align-items:center;gap:12px;margin-top:16px;padding-top:16px;border-top:1px solid #ffffff1a}
.quote .by i{width:40px;height:40px;border-radius:50%;flex:none}
.quote .by b{display:block;font-size:18px;line-height:20px}
.quote .by small{font-size:12px;color:#ffffffcc}

/* faq */
.faq{display:grid;grid-template-columns:344px 1fr;gap:60px;margin-top:0}
.faq h2{font-size:48px;line-height:53px}
.faq-list details{border-bottom:1px solid #ffffff1a;padding:0 0 30px;margin-bottom:30px}
.faq-list summary{display:flex;justify-content:space-between;gap:24px;cursor:pointer;list-style:none;font-family:var(--head);font-weight:700;font-size:22px;line-height:26px;letter-spacing:-.02em}
.faq-list summary::-webkit-details-marker{display:none}
.faq-list summary h3{font:inherit;letter-spacing:inherit}
.faq-list summary svg{width:24px;height:24px;flex:none;transition:transform .2s}
.faq-list details[open] summary svg{transform:rotate(45deg)}
.faq-list p{margin-top:16px;font-size:18px;line-height:27px;color:var(--muted);max-width:830px}

/* footer */
.site-footer{padding:140px 0 60px;background:radial-gradient(60% 40% at 50% 35%,#2a0a5c55,transparent)}
.foot-cta{text-align:center}
.foot-cta h3{font-size:60px;line-height:66px}
.foot-cta p{max-width:538px;margin:16px auto 0;font-size:22px;line-height:28.6px;color:var(--muted)}
.foot-cta .btn{margin-top:32px;height:57px;padding:0 32px;font-size:19px}
.foot-art{margin:60px auto 0;max-width:1188px;height:300px;border-radius:var(--r-xl);background:linear-gradient(180deg,#1f0b3d,#0e0e0e);box-shadow:var(--inset);display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:24px}
.foot-art div{border-radius:var(--r-md);background:#ffffff0d;padding:18px;font-size:14px;color:#ffffffb3}
.foot-art b{display:block;font-family:var(--head);font-size:28px;color:#fff;margin-bottom:6px}
.foot-grid{display:grid;grid-template-columns:420px repeat(3,1fr);gap:40px;margin-top:80px;padding:0 40px}
.foot-grid h4{font-size:18px;font-weight:700;margin-bottom:20px}
.foot-grid ul{list-style:none;margin:0;padding:0;display:grid;gap:12px;font-size:18px}
.foot-grid ul a:hover{color:#ffffffb3}
.foot-brand p{margin-top:12px;font-size:18px;max-width:400px}
.socials{display:flex;gap:10px;margin-top:20px}
.socials a{width:44px;height:44px;border-radius:12px;background:var(--chip);display:grid;place-items:center}
.socials svg{width:20px;height:20px}
.copyright{margin-top:60px;padding:24px 40px 0;border-top:1px solid #ffffff1a;font-size:14px;color:#ffffff99;display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}

/* ---------- agent pages ---------- */
.a-hero{position:relative;overflow:hidden;min-height:730px}
.a-hero .wrap{display:grid;grid-template-columns:600px 1fr;gap:40px;align-items:center;min-height:730px}
.a-badge{display:flex;align-items:center;gap:12px;font-size:16px;font-weight:500}
.a-badge i{width:44px;height:44px;border-radius:10px;display:grid;place-items:center;background:#ffffff40}
.a-badge svg{width:28px;height:28px}
.a-hero h1{margin-top:32px;font-size:64px;line-height:68px}
.a-hero ul{list-style:none;padding:0;margin:36px 0 0;display:grid;gap:12px;font-size:19px}
.a-hero li{display:flex;gap:12px;align-items:baseline}
.a-hero li::before{content:"";width:7px;height:7px;flex:none;background:#ff4ce2;border-radius:2px;transform:translateY(-3px)}
.a-btns{display:flex;gap:16px;margin-top:40px}
.a-btns .btn{height:58px;padding:0 32px;font-size:19px}
.a-note{margin-top:36px;font-size:13px;line-height:18px;color:#ffffffcc;max-width:580px}
.a-note a{text-decoration:underline}
.a-art{position:relative;height:600px}
.a-orb{position:absolute;left:50%;top:50%;width:300px;height:300px;margin:-150px 0 0 -150px;border-radius:50%;display:grid;place-items:center;box-shadow:0 30px 80px #0007,inset 0 -18px 40px #0003}
.a-orb svg{width:150px;height:150px}
.a-art .ch{position:absolute;width:76px;height:76px;border-radius:18px;font-size:26px;box-shadow:0 0 0 6px #fff,0 18px 30px #0005;animation:bob 6s ease-in-out infinite}
.a-art .ch:nth-child(2n){animation-delay:-3s}
@keyframes bob{50%{transform:translateY(-10px)}}
.t-gpt{background:radial-gradient(90% 120% at 100% 0%,#26be9f 0%,#0a5850 45%,#063632 100%)}
.t-dots{background:radial-gradient(90% 120% at 100% 0%,#7b3ff3 0%,#380e9a 45%,#22065e 100%)}
.t-claude{background:radial-gradient(90% 120% at 100% 0%,#f6894c 0%,#913510 45%,#521c07 100%)}
.a-sec{max-width:var(--wrap);margin:80px auto;padding:0 20px}
.a-sec+.a-sec::before{content:"";display:block;height:1px;background:#ffffff14;margin-bottom:80px}
.a-sec h2{font-size:36px;line-height:42px;max-width:820px}
.a-sec .lead{margin-top:16px;max-width:720px;font-size:17px;line-height:27px;color:#c4c4c4}
.a-sec.mid h2,.a-sec.mid .lead{margin-left:auto;margin-right:auto;text-align:center}
.steps2{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:44px}
.panel{border-radius:var(--r-md);background:var(--card-solid);box-shadow:var(--inset);padding:32px}
.panel-top{display:flex;align-items:center;gap:12px;font-weight:500;font-size:16px}
.panel-top .n{width:32px;height:32px;border-radius:50%;box-shadow:inset 0 0 0 1px var(--acc);color:var(--acc);display:grid;place-items:center;font-size:14px}
.panel-top small{margin-left:auto;color:#ffffffb3;font-size:13px;display:flex;align-items:center;gap:6px}
.panel-top small.live::before{content:"";width:6px;height:6px;border-radius:50%;background:#22c55e}
.panel h3{margin-top:24px;font-size:24px;line-height:30px}
.panel>p{margin-top:8px;font-size:15px;line-height:26px;color:#ffffffcc}
.code{margin-top:24px;border-radius:14px;background:#141414;box-shadow:var(--inset);overflow:hidden}
.code-top{display:flex;align-items:center;gap:16px;padding:12px 16px;border-bottom:1px solid #ffffff14;font:12px ui-monospace,Menlo,monospace;color:#ffffff99}
.code-top .dots{display:flex;gap:6px}
.code-top button{margin-left:auto;padding:4px 12px;border-radius:999px;background:#fff;color:#111;font-size:13px;font-family:var(--body);font-weight:500}
.code code{display:block;padding:22px 20px;font:14px/22px ui-monospace,Menlo,monospace;word-break:break-all}
.panel .fine{margin-top:20px;font-size:13px;line-height:18px;color:#ffffffb3}
.chat{margin-top:24px;border-radius:14px;background:#141414;box-shadow:var(--inset);padding:20px;display:grid;gap:14px;font-size:14px;line-height:21px}
.chat .me{justify-self:end;max-width:460px;padding:12px 16px;border-radius:12px;background:#152a26;box-shadow:inset 0 0 0 1px var(--acc)}
.chat .bot{max-width:460px;padding:12px 16px;border-radius:12px;background:#1f1f1f;box-shadow:var(--inset)}
.chat .bot small{display:block;margin-top:6px;color:#ffffff99;font-size:11px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.chips button{padding:6px 12px;border-radius:999px;box-shadow:var(--inset);font-size:13px}
.chips button:hover{background:#ffffff12}
.steps4{display:grid;grid-template-columns:repeat(4,1fr);gap:40px;margin-top:40px;font-size:14px;line-height:22px;color:#d9d9d9}
.steps4 i{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;box-shadow:inset 0 0 0 1px var(--acc);color:var(--acc);font-style:normal;font-size:12px;margin-bottom:18px}
.band{padding:110px 0}
.band h2{font-size:48px;line-height:53px;text-align:center;max-width:780px;margin:0 auto}
.band .lead{margin:16px auto 0;max-width:620px;text-align:center;font-size:19px;line-height:28px;color:#ffffffe6}
.orbit{position:relative;width:640px;height:640px;margin:60px auto 0}
.orbit::before,.orbit::after{content:"";position:absolute;border-radius:50%;border:1px solid #ffffff1f}
.orbit::before{inset:0}.orbit::after{inset:110px}
.orbit .core{position:absolute;left:50%;top:50%;width:190px;height:190px;margin:-95px;border-radius:50%;border:6px solid #fff;display:grid;place-items:center}
.orbit .core svg{width:110px;height:110px}
.orbit .ch{position:absolute;width:56px;height:56px;margin:-28px;border-radius:50%;box-shadow:0 0 0 4px #fff,0 10px 24px #0005;font-size:15px}
.table{margin-top:40px;border-radius:var(--r-md);box-shadow:var(--inset);overflow:hidden;font-size:15px}
.table .tr{display:grid;grid-template-columns:290px 1fr 1fr;border-top:1px solid #ffffff1a}
.table .tr:first-child{border-top:0;background:#1a1919;font-weight:700}
.table .tr>*{padding:18px 24px;line-height:23px;color:#ffffffd9}
.table .tr>:first-child{font-weight:700;color:#fff}
.cards3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:40px}
.cards4{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:40px}
.cards2{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:40px}
.fcard{border-radius:var(--r-md);background:var(--card-solid);box-shadow:var(--inset);padding:28px}
.fcard .ic{width:40px;height:40px;border-radius:10px;display:grid;place-items:center;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--acc) 40%,transparent);color:var(--acc);background:color-mix(in srgb,var(--acc) 8%,transparent)}
.fcard .ic svg{width:20px;height:20px}
.fcard h3{margin-top:28px;font-size:20px;line-height:26px}
.fcard p{margin-top:8px;font-size:15px;line-height:24px;color:#9d9d9d}
.fcard q{display:block;margin-top:14px;padding:14px;border-radius:12px;background:#141414;font-size:14px;line-height:21px;color:#ffffffd9;quotes:none}
.plats{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-top:40px}
.plat{display:flex;align-items:center;gap:12px;padding:16px;border-radius:16px;background:var(--card-solid);box-shadow:var(--inset);font-size:15px}
.plat .ch{width:32px;height:32px}
.plat small{display:block;font-size:12px;color:#ffffff99}
.agents{display:flex;flex-wrap:wrap;gap:12px;margin-top:32px}
.agents a{display:flex;align-items:center;gap:10px;padding:10px 18px 10px 10px;border-radius:999px;background:var(--card-solid);box-shadow:var(--inset);font-size:15px}
.agents a[aria-current]{box-shadow:inset 0 0 0 1px var(--acc)}
.agents i{width:28px;height:28px;border-radius:50%;display:grid;place-items:center}
.agents svg{width:16px;height:16px}
.a-sec .faq-list{margin-top:40px;max-width:980px}
.a-cta{padding:100px 0;text-align:center}
.a-cta h2{font-size:48px;line-height:53px}
.a-cta p{margin:16px auto 0;max-width:560px;font-size:19px;line-height:28px;color:#ffffffe6}
.a-cta .a-btns{justify-content:center}

/* ---------- responsive ---------- */
@media (max-width:1359px){
  .tools-grid{grid-template-columns:1.43fr 1fr}
  .tools-grid .r2{grid-template-columns:1fr 1.47fr}
  .tool.full{grid-template-columns:1fr 1.2fr}
  .charts{grid-template-columns:repeat(2,1fr);padding-right:30px}
}
@media (max-width:1279px){
  .main-nav{margin-left:60px;gap:32px}
  .lifecycle{left:40px;right:40px}
  .a-hero .wrap{grid-template-columns:1fr 1fr}
}
@media (max-width:1023px){
  .main-nav,.header-cta{display:none}
  .burger{display:grid}
  .mobile-nav:not([hidden]){display:grid;position:fixed;top:81px;left:0;right:0;bottom:0;z-index:49;background:var(--bg);padding:20px;gap:6px;align-content:start;overflow:auto}
  .mobile-nav a{padding:14px 4px;font-size:20px;border-bottom:1px solid #ffffff14}
  .mobile-nav .btn{margin-top:14px;border:0}
  .support{display:none}
  .who-grid{grid-template-columns:1fr;gap:60px;max-width:560px;margin-left:auto;margin-right:auto}
  .via h3{font-size:34px;line-height:38px}
  .via{padding:32px}
  .via.wide{grid-template-columns:1fr}
  .tools-grid,.tools-grid .r2{grid-template-columns:1fr}
  .tool.full{grid-template-columns:1fr}
  .tool.full .mock{height:420px}
  .faq{grid-template-columns:1fr;gap:20px}
  .lifecycle{grid-template-columns:repeat(4,1fr);bottom:24px}
  .step{height:92px}
  .poster-big{font-size:130px;top:120px}
  .poster-kicker{font-size:44px}
  .foot-grid{grid-template-columns:1fr 1fr;padding:0}
  .a-hero .wrap{grid-template-columns:1fr;padding-top:50px}
  .a-art{height:440px}
  .steps2,.cards2{grid-template-columns:1fr}
  .cards3{grid-template-columns:1fr 1fr}
  .cards4,.steps4{grid-template-columns:1fr 1fr}
  .plats{grid-template-columns:repeat(3,1fr)}
}
@media (max-width:767px){
  .hero{padding-top:32px}
  .hero h1{font-size:40px;line-height:44px;margin-top:16px}
  .rotor-icon{width:40px;height:40px;border-radius:9px}
  .rotor-icon svg{width:28px;height:28px}
  .hero-sub{font-size:18px;line-height:24px;margin-top:24px}
  .hero-doodle{display:none}
  .laurels{gap:8px}
  .channel-strip{max-width:330px;gap:8px}
  .toggle-row{margin:10px 0 30px;font-size:13px}
  .demo-sec{padding-top:40px}
  .demo{height:356px;border-radius:20px}
  .demo-title{font-size:24px;line-height:30px;text-align:left;padding:30px 120px 0 20px}
  .demo-frame{left:20px;right:-60px;top:110px}
  .demo-win{grid-template-columns:120px 1fr}
  .demo-side{padding:14px 10px}
  .demo-side .brand{font-size:15px}.demo-side .brand svg{width:24px;height:24px}
  .bubble{font-size:11px;line-height:15px;bottom:60px;max-width:200px;padding:8px}
  .reply.on{grid-template-columns:1fr 1fr;font-size:10px;bottom:110px;left:10px}
  .ask{height:32px;font-size:12px;bottom:8px}
  .sec{padding:50px 0}
  .sec-title{font-size:30px;line-height:34px}
  .stats-title{font-size:24px;line-height:30px}
  .sec-sub{font-size:18px;line-height:24px}
  .stat{width:230px;height:128px;padding:18px}
  .stat b{font-size:26px;line-height:30px}
  .who{padding:64px 0}
  .who-item h3{font-size:22px;line-height:28px}
  .poster{height:350px;margin:30px 0 0}
  .poster-kicker{font-size:26px;top:14px}
  .poster-big{font-size:64px;top:60px}
  .lifecycle{left:14px;right:14px;bottom:14px;gap:6px}
  .step{height:62px;padding:8px;font-size:10px;line-height:12px;border-radius:10px}
  .step i{font-size:14px}
  .via-grid{grid-template-columns:1fr}
  .via{min-height:0;padding:24px}
  .via h3{font-size:26px;line-height:30px}
  .via h3 svg{width:30px;height:30px}
  .via p{font-size:18px;line-height:26px}
  .via .mock,.via.wide .mock{height:240px;margin-top:30px}
  .via.flip .mock{margin:0 0 30px}
  .tools{padding:50px 0}
  .tool{min-height:0;padding:24px}
  .tool .tag{font-size:14px;padding:6px 12px}
  .tool h3{font-size:26px;line-height:32px}
  .tool p{font-size:18px;line-height:24px}
  .tool .mock,.tool.full .mock{height:260px;min-height:260px;flex:none}
  .tools-grid .r2 .tool{min-height:0}
  .charts{grid-template-columns:1fr 1fr;grid-auto-rows:110px;padding:20px}
  .charts .c svg{height:40px}
  .big-tile{width:96px;height:96px;border-radius:20px}
  .big-tile .ch{width:44px;height:44px;font-size:16px;border-radius:10px}
  .tile-rows{gap:8px;margin-top:40px}.tile-row{gap:8px}
  .tile-row:nth-child(2){transform:translateX(-52px)}
  .cta-band{flex-direction:column;align-items:flex-start;padding:32px 24px;gap:24px}
  .cta-band h3{font-size:30px;line-height:34px}
  .cta-band p{font-size:18px;line-height:24px}
  .cta-band .go{margin-left:0}
  .cta-band .go svg{display:none}
  .wall{columns:1}
  .faq h2{font-size:30px;line-height:34px}
  .faq-list summary{font-size:18px;line-height:24px}
  .faq-list p{font-size:16px;line-height:24px}
  .site-footer{padding:80px 0 40px}
  .foot-cta h3{font-size:40px;line-height:44px}
  .foot-cta p{font-size:18px;line-height:24px}
  .foot-art{grid-template-columns:1fr 1fr;height:auto}
  .foot-grid{grid-template-columns:1fr}
  .copyright{padding:24px 0 0}
  .a-hero h1{font-size:40px;line-height:44px}
  .a-hero ul{font-size:17px}
  .a-btns{flex-direction:column}
  .a-btns .btn{width:100%;height:46px;font-size:17px}
  .a-art{height:340px}
  .a-orb{width:200px;height:200px;margin:-100px}
  .a-orb svg{width:100px;height:100px}
  .a-art .ch{width:56px;height:56px;font-size:20px;border-radius:14px}
  .a-sec{margin:56px auto}
  .a-sec+.a-sec::before{margin-bottom:56px}
  .a-sec h2{font-size:30px;line-height:34px}
  .panel{padding:24px}
  .band{padding:64px 0}
  .band h2,.a-cta h2{font-size:30px;line-height:34px}
  .orbit{width:320px;height:320px}
  .orbit::after{inset:56px}
  .orbit .core{width:100px;height:100px;margin:-50px;border-width:4px}
  .orbit .core svg{width:56px;height:56px}
  .orbit .ch{width:36px;height:36px;margin:-18px;font-size:11px}
  .table{overflow-x:auto}
  .table .tr{grid-template-columns:120px 220px 220px;width:max-content}
  .cards3,.cards4,.steps4{grid-template-columns:1fr}
  .plats{grid-template-columns:1fr 1fr}
}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none!important;transition:none!important}
  html{scroll-behavior:auto}
}
`;
