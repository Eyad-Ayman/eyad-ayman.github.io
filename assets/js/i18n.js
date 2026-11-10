// English / Arabic switch. The page is written in English; this swaps every
// text node (and a few attributes) for its Arabic line from the dictionary
// below, flips the page to right-to-left, and puts the English back on the
// way out. The bio and the work history are read from data/about.json and
// data/experience.json (their *_ar fields) by content-loader.js.
//
// To change a translation: find the English line on the left and edit the
// Arabic on the right. A line missing here simply stays in English.
(function () {
  "use strict";

  var AR = {
    // navigation + running header
    "Portfolio": "بورتفوليو",
    "Home": "الرئيسية",
    "About": "عني",
    "Work": "الشغل",
    "Motion": "موشن",
    "Contact": "تواصل",
    "Studio ↗": "الاستوديو ↗",
    "Store ↗": "الاستور ↗",
    "Dark": "داكن",
    "Light": "فاتح",
    "Menu": "القائمة",
    "Close": "إغلاق",
    "01 — About": "٠١ — عني",
    "02 — Work": "٠٢ — الشغل",
    "03 — Motion": "٠٣ — موشن",
    "04 — Studio": "٠٤ — الاستوديو",
    "05 — Questions": "٠٥ — أسئلة",
    "06 — Contact": "٠٦ — تواصل",
    "01.5 — Clients": "٠١.٥ — العملاء",

    // splash
    "[ Eyad Ayman ]": "[ إياد أيمن ]",
    "Giza, Egypt": "الجيزة، مصر",
    "[ Graphic Design ]": "[ جرافيك ديزاين ]",
    "[ Video Editing ]": "[ مونتاج ]",
    "[ 3D Art ]": "[ ثري دي ]",

    // cover
    "- The Designer -": "- المصمم -",
    "GRAPHIC DESIGNER": "جرافيك ديزاينر",
    "VIDEO EDITOR": "مونتير",
    "3D ARTIST": "فنان ثري دي",
    "Hire me →": "اشتغل معايا ←",
    "My CV ↗": "السي في ↗",
    "this is me, hi!": "ده أنا، أهلاً!",
    "FROM EGYPT": "من مصر",
    "THE CAPITAL GIZA.": "الجيزة.",
    "A CALM MIND IS": "العقل الهادي",
    "THE STRONGEST": "هو الأقوى",
    "[ Based in ]": "[ مقيم في ]",
    "[ Motto ]": "[ شعاري ]",

    // contents
    "Contents": "المحتويات",
    "Studio": "الاستوديو",
    "FAQ": "أسئلة",
    "Eyad Ayman": "إياد أيمن",

    // about
    "01 — About the Artist": "٠١ — عن الفنان",
    "That's Me": "ده أنا",
    "Hey there!": "أهلاً!",
    "Work Experience": "الخبرات",
    "View full history on LinkedIn →": "الخبرات كاملة على لينكدإن ←",

    // clients
    "Brands I've": "براندات",
    "worked with": "اشتغلت معاها",
    "& the people behind them": "والناس اللي وراها",
    "[ Brands ]": "[ براندات ]",
    "[ Institutions & events ]": "[ مؤسسات وفعاليات ]",
    "[ In-house ]": "[ اشتغلت فيها ]",
    "[ Egyptian Museum ]": "[ المتحف المصري ]",
    "Egyptian Food Bank": "بنك الطعام المصري",
    "Ministry of Communications & IT": "وزارة الاتصالات",
    "Ministry of Youth & Sports": "وزارة الشباب والرياضة",
    "Youth & Sports": "الشباب والرياضة",

    // gallery
    "Keep scrolling": "كمّل",
    "02 — Selected Work": "٠٢ — شغل مختار",
    "Gallery of Work": "معرض الشغل",
    "Behance & Instagram, mixed →": "من بيهانس وإنستجرام ←",
    "Posters, campaigns, branding and reels — synced live from Behance and Instagram.": "بوسترات وحملات وبراندينج وريلز — بتتحدّث لوحدها من بيهانس وإنستجرام.",
    "See Full Portfolio on Behance →": "البورتفوليو كامل على بيهانس ←",
    "photo manipulation": "فوتو مانيبوليشن",
    "campaign": "حملة",
    "Logo": "لوجو",
    "Banner": "بانر",
    "Rebranding": "ريبراندينج",

    // motion
    "03 — Motion": "٠٣ — موشن",
    "Showreel": "شوريل",
    "video work, in motion →": "شغل الفيديو ←",
    "Reels": "ريلز",
    "· synced straight from Instagram": "· من إنستجرام على طول",
    "Behind The Work": "ورا الشغل",
    "the art speaks ♡": "الفن بيتكلم ♡",
    "03.5 — Process": "٠٣.٥ — الطريقة",
    "Behind": "ورا",
    "The Work": "الشغل",
    "One real piece — the «حبيبي ليه» song cover — built step by step, the way it actually happened in Photoshop and Premiere.": "شغلة حقيقية — غلاف أغنية «حبيبي ليه» — خطوة بخطوة، زي ما اتعملت بالظبط على فوتوشوب وبريمير.",
    "Idea": "الفكرة",
    "Sketch": "اسكتش",
    "Design": "التصميم",
    "Edit": "التعديل",
    "Final": "النهائي",
    "A feeling first: Cairo at night, a motorbike, an old tape. Refs pinned before a single layer exists.": "إحساس الأول: القاهرة بالليل، موتوسيكل، شريط قديم. المراجع بتتعلّق قبل أي لير.",
    "Rough lines over the refs to lock the pose, the bike and where the title sits.": "خطوط سريعة فوق المراجع عشان أثبّت الوقفة والموتوسيكل ومكان العنوان.",
    "Cutting the figure out, building the scene, lettering the Arabic title by hand.": "بقص الشخص، وببني المشهد، وبرسم العنوان العربي بإيدي.",
    "Grading it into one world: warm film tones, grain, the yellow pushed.": "بلوّن كله في عالم واحد: ألوان فيلم دافية، جرين، والأصفر عالي.",
    "Bringing the cover to life on a timeline: drift, flicker, grain.": "بحرّك الغلاف على التايملاين: حركة، رعشة، جرين.",
    "Exported, released with the song. On to the next one.": "اتصدّر ونزل مع الأغنية. على اللي بعده.",
    "Moodboard": "موود بورد",
    "Sketching": "اسكتش",
    "Cutout + layers": "قص ولايرز",
    "Colour grade": "تلوين",
    "Timeline": "تايملاين",
    "Exported ✓": "اتصدّر ✓",
    "Before": "قبل",
    "After": "بعد",
    "Layers": "اللايرز",
    "Made with the same tools I use to create.": "اتعمل بنفس الأدوات اللي بشتغل بيها.",
    "Enter EYAD Studio": "ادخل استوديو إياد",
    "Create Something": "اعمل حاجة",
    "Extraordinary.": "استثنائية.",
    "more of the work →": "شغل أكتر ←",

    // studio + store
    "04 — Studio & Store": "٠٤ — الاستوديو والاستور",
    "Made By Eyad": "صنع إياد",
    "make it, then wear it →": "اعملها، وبعدين البسها ←",
    "01 — The Studio": "٠١ — الاستوديو",
    "02 — The Store": "٠٢ — الاستور",
    "Type": "النوع",
    "Tools": "الأدوات",
    "Runs": "بيشتغل",
    "Files": "الملفات",
    "Price": "السعر",
    "Made": "الصنع",
    "Delivery": "التوصيل",
    "Payment": "الدفع",
    "Creative suite": "برامج تصميم كاملة",
    "Image, vector, video, 3D, film camera": "صور، فيكتور، فيديو، ثري دي، كاميرا فيلم",
    "In the browser or as an app, offline": "على المتصفح أو كأبلكيشن، من غير نت",
    "PSD in and out, never leave your device": "بيفتح ويحفظ PSD، وملفاتك مبتخرجش من جهازك",
    "Free": "مجاناً",
    "Clothes, prints, objects": "لبس، برنتات، حاجات",
    "In Cairo, small runs": "في القاهرة، كميات صغيرة",
    "All over Egypt": "لكل مصر",
    "Cash on delivery": "الدفع عند الاستلام",
    "My own creative suite: layered photo editing, vector design, video, 3D, film camera and templates — right in your browser or installed as an app. PSD in and out, on-device AI, works offline. Free, and your files never leave your device.": "برامج التصميم الخاصة بيا: تعديل صور بالطبقات، فيكتور، فيديو، ثري دي، كاميرا فيلم وتمبلتس — على المتصفح أو كأبلكيشن. بيفتح ويحفظ PSD، فيه ذكاء اصطناعي على جهازك، وبيشتغل من غير نت. مجاناً، وملفاتك مبتخرجش من جهازك.",
    "Heavyweight black clothes, prints and objects I design, made in Cairo. Small runs — delivery all over Egypt, cash on delivery.": "لبس أسود تقيل وبرنتات وحاجات من تصميمي، معمولة في القاهرة. كميات صغيرة — توصيل لكل مصر، والدفع عند الاستلام.",
    "Enter Studio": "ادخل الاستوديو",
    "Shop the Store": "اشتري من الاستور",
    "live": "شغال",
    "Drop 01": "الدفعة ٠١",
    "Heavyweight": "قماش تقيل",
    "Small runs ✶ Made in Cairo ✶ Cash on delivery ✶ All over Egypt ✶ Small runs ✶ Made in Cairo ✶ Cash on delivery ✶ All over Egypt ✶": "كميات صغيرة ✶ صنع في القاهرة ✶ الدفع عند الاستلام ✶ لكل مصر ✶ كميات صغيرة ✶ صنع في القاهرة ✶ الدفع عند الاستلام ✶ لكل مصر ✶",
    "open": "مفتوح",

    // FAQ
    "05 — Questions": "٠٥ — أسئلة",
    "the short version →": "باختصار ←",
    "Are you available for freelance work?": "بتاخد شغل فريلانس؟",
    "Yes. Message me on WhatsApp with what you need and I'll get back to you.": "أيوه. ابعتلي على واتساب اللي محتاجه وهرد عليك.",
    "What kind of projects do you take on?": "بتاخد مشاريع إيه؟",
    "Branding and print, photo manipulation and digital art, motion graphics and video editing, and social media campaigns.": "براندينج وطباعة، فوتو مانيبوليشن وديجيتال آرت، موشن جرافيك ومونتاج، وحملات سوشيال ميديا.",
    "Is it just graphic design, or video and 3D too?": "جرافيك بس، ولا فيديو وثري دي كمان؟",
    "All three, genuinely — graphic design, video editing, and 3D art with Blender. I led video editing at the Ministry of Youth and Sports, and today I design for Infinix and Transsion with motion work alongside.": "التلاتة بجد — جرافيك ديزاين ومونتاج وثري دي على بلندر. قدت المونتاج في وزارة الشباب والرياضة، والنهارده بصمم لـ إنفينكس وترانشن ومعاهم شغل موشن.",
    "What software do you work in?": "بتشتغل على برامج إيه؟",
    "Photoshop, Illustrator, and Premiere Pro day to day, plus Blender for 3D.": "فوتوشوب وإليستريتور وبريمير بشكل يومي، وبلندر للثري دي.",
    "What are EYAD Studio and the Store?": "يعني إيه استوديو إياد والاستور؟",
    "Both live at madebyeyad.web.app. The Studio is my free creative suite — image, vector, video, 3D and a film camera, right in your browser. The Store sells heavyweight black clothes, prints and objects I design, made in Cairo in small runs, with delivery all over Egypt and cash on delivery.": "الاتنين على madebyeyad.web.app. الاستوديو برامج التصميم المجانية بتاعتي — صور وفيكتور وفيديو وثري دي وكاميرا فيلم، على المتصفح على طول. والاستور بيبيع لبس أسود تقيل وبرنتات وحاجات من تصميمي، معمولة في القاهرة بكميات صغيرة، مع توصيل لكل مصر ودفع عند الاستلام.",
    "What's the fastest way to reach you?": "أسرع طريقة أوصلك بيها؟",
    "WhatsApp — the button on the Contact section below goes straight to it. Instagram, LinkedIn, and Behance are all linked there too if you'd rather start there.": "واتساب — الزرار اللي في قسم التواصل تحت بيوديك عليه على طول. وإنستجرام ولينكدإن وبيهانس موجودين هناك برضه لو حابب تبدأ منهم.",

    // contact + brief
    "06 — Get In Touch": "٠٦ — تواصل معايا",
    "Contact Me": "كلّمني",
    "let's talk!": "يلا نتكلم!",
    "Have a project in mind, or just want to say hi? WhatsApp is the fastest way to reach me — or find me on any of these.": "عندك مشروع، أو حابب تقول أهلاً بس؟ واتساب أسرع طريقة توصلّي — أو لاقيني على أي واحد من دول.",
    "[ Start a project ]": "[ ابدأ مشروع ]",
    "Takes 20 seconds": "بياخد ٢٠ ثانية",
    "What do you need?": "محتاج إيه؟",
    "Branding & logo": "براندينج ولوجو",
    "Posters & key visuals": "بوسترات وكي فيجوال",
    "Social media": "سوشيال ميديا",
    "Video & motion": "فيديو وموشن",
    "A full-time hire": "توظيف فول تايم",
    "When?": "إمتى؟",
    "This week": "الأسبوع ده",
    "This month": "الشهر ده",
    "Flexible": "مرن",
    "Budget": "الميزانية",
    "Under 5K EGP": "أقل من ٥ آلاف جنيه",
    "5K–15K EGP": "٥–١٥ ألف جنيه",
    "15K+ EGP": "أكتر من ١٥ ألف جنيه",
    "Let's talk": "نتكلم",
    "Your name / company": "اسمك / الشركة",
    "Send the brief on WhatsApp →": "ابعت الطلب على واتساب ←",
    "Message me on WhatsApp": "كلّمني على واتساب",
    "My CV": "السي في",
    "GIZA, EGYPT": "الجيزة، مصر",

    // sign-off, footer, toasts, game
    "Let's Make": "يلا نعمل",
    "Something": "حاجة",
    "Great": "عظيمة",
    "Say Hello →": "قول أهلاً ←",
    "EA26 —— GIZA, EGYPT —— OPEN FOR WORK": "EA26 —— الجيزة، مصر —— متاح للشغل",
    "Thanks": "شكراً",
    "see you around!": "نشوفك!",
    "Psst… still scrolling?": "لسه بتقلّب؟",
    "I'm available for hire!": "أنا متاح للشغل!",
    "Let's talk →": "يلا نتكلم ←",
    "You found the easter egg! 🎉": "لقيت المفاجأة! 🎉",
    "Hire me now — I promise I'm more useful than this joke.": "شغّلني دلوقتي — أوعدك إني مفيد أكتر من النكتة دي.",
    "Take me to Contact →": "وديني للتواصل ←",
    "Or play a quick game 🎮": "أو العب لعبة سريعة 🎮",
    "Catch The Palette": "امسك الألوان",
    "Score:": "النقط:",
    "Lives:": "الأرواح:",
    "Best:": "الأحسن:",
    "Game Over": "خسرت",
    "Play Again": "العب تاني",
    "Move your mouse (or finger) to catch the red squares. Miss 3 and it's game over.": "حرّك الماوس (أو صباعك) عشان تمسك المربعات الحمرا. لو فاتك ٣ تخسر."
  };

  // a few attributes worth translating
  var AR_ATTR = {
    "Optional": "اختياري"
  };

  var STORE_KEY = "lang";
  var root = document.documentElement;
  var originals = new WeakMap(); // text node -> English text
  var attrOriginals = [];         // [element, attribute, English]
  var current = "en";
  var SKIP = "script, style, noscript, svg, [data-mixed-gallery] .project-name, [data-showreel-strip] .showreel-caption, [data-no-i18n]";

  function normalise(s) { return s.replace(/\s+/g, " ").trim(); }

  function translateNode(node) {
    var raw = node.nodeValue;
    var key = normalise(raw);
    if (!key) return;
    var ar = AR[key];
    var m = ar === undefined && key.match(/^(\d+) reels?$/);
    if (m) ar = m[1] + " ريلز";
    if (ar === undefined) return;
    if (!originals.has(node)) originals.set(node, raw);
    var lead = raw.match(/^\s*/)[0];
    var tail = raw.match(/\s*$/)[0];
    node.nodeValue = lead + ar + tail;
  }

  function walk(scope) {
    var w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    var n, list = [];
    while ((n = w.nextNode())) {
      if (n.parentElement && n.parentElement.closest(SKIP)) continue;
      list.push(n);
    }
    list.forEach(translateNode);
    scope.querySelectorAll && scope.querySelectorAll("[placeholder]").forEach(function (el) {
      var v = el.getAttribute("placeholder");
      if (AR_ATTR[v]) { attrOriginals.push([el, "placeholder", v]); el.setAttribute("placeholder", AR_ATTR[v]); }
    });
  }

  function restore() {
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = w.nextNode())) {
      if (originals.has(n)) { n.nodeValue = originals.get(n); originals.delete(n); }
    }
    attrOriginals.forEach(function (r) { r[0].setAttribute(r[1], r[2]); });
    attrOriginals = [];
  }

  var observer = new MutationObserver(function (records) {
    if (current !== "ar") return;
    observer.disconnect();
    records.forEach(function (r) {
      if (r.type === "characterData") {
        if (!r.target.parentElement || !r.target.parentElement.closest(SKIP)) translateNode(r.target);
      } else {
        r.addedNodes.forEach(function (node) {
          if (node.nodeType === 3) { if (!node.parentElement || !node.parentElement.closest(SKIP)) translateNode(node); }
          else if (node.nodeType === 1) walk(node);
        });
      }
    });
    observe();
  });
  function observe() { observer.observe(document.body, { childList: true, subtree: true, characterData: true }); }

  function setLang(lang, remember) {
    if (lang === current) return;
    current = lang;
    if (lang === "ar") {
      root.setAttribute("lang", "ar");
      root.setAttribute("dir", "rtl");
      root.classList.add("is-ar");
      walk(document.body);
      observe();
    } else {
      observer.disconnect();
      root.setAttribute("lang", "en");
      root.removeAttribute("dir");
      root.classList.remove("is-ar");
      restore();
    }
    document.querySelectorAll("[data-lang-toggle]").forEach(function (b) {
      b.textContent = lang === "ar" ? "EN" : "ع";
      b.setAttribute("aria-label", lang === "ar" ? "Switch to English" : "التبديل للعربي");
    });
    if (remember) { try { localStorage.setItem(STORE_KEY, lang); } catch (e) {} }
    document.dispatchEvent(new CustomEvent("langchange", { detail: { lang: lang } }));
  }

  window.eyadLang = function () { return current; };

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-lang-toggle]");
    if (!b) return;
    e.preventDefault();
    setLang(current === "ar" ? "en" : "ar", true);
  });

  var saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch (e) {}
  var wanted = saved || ((navigator.language || "").toLowerCase().indexOf("ar") === 0 ? "ar" : "en");
  if (/[?&]lang=ar\b/.test(location.search)) wanted = "ar";
  if (/[?&]lang=en\b/.test(location.search)) wanted = "en";
  if (wanted === "ar") setLang("ar", false);
})();
