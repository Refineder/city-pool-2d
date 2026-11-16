const strings = {
  en: {
    title: '8-Ball Pool', intro: 'Practice your break or play a friend online.', city: 'Back to the city',
    language: 'Language', solo: 'Practice', multiplayer: 'Play online', back: 'Back',
    create: 'Create room', join: 'Join room', connect: 'Join game',
    restart: 'New rack', rematch: 'Play again', menu: 'Menu', mute: 'Mute', unmute: 'Unmute',
    hostHint: 'Share this room code with another city member.', joinHint: 'Room code',
    aimHint: 'Pull back from the white ball, then release to shoot.',
    keyboardHint: 'Use the arrow keys to aim and adjust power. Press Space to shoot.',
    keyboardPlace: 'Use the arrow keys to move the white ball. Press Space to place it.',
    tableLabel: 'Pool table', power: 'Power',
    shots: 'Shots', potted: 'Pocketed', you: 'You', rival: 'Opponent', solids: 'Solids', stripes: 'Stripes',
    openTable: 'Open table', yourTurn: 'Your turn', rivalTurn: 'Opponent’s turn', shooting: 'Shot in progress',
    ballInHand: 'Ball in hand', placeCueHint: 'Tap a free spot on the table to place the white ball.',
    badPlacement: 'Choose a spot clear of the rails, pockets and other balls.',
    accept: 'Confirm', reject: 'Cancel', confirmRestart: 'Start a new practice rack?', confirmExit: 'Leave this game?',
    rivalLeft: 'Your opponent left the room.', won: 'You won', lost: 'You lost',
    soloDone: 'Table cleared', connecting: 'Connecting…', waiting: 'Waiting for another player…',
    closed: 'The connection closed. Open Play online to try again.',
    sessionExpired: 'Your city session expired. Return to the city to sign in.',
    notFound: 'That room is unavailable. Check the code or ask for a new one.',
    code4: 'Enter the 4-character room code.',
    serverBusy: 'Online pool is busy. Try again in a moment.',
    moveRejected: 'That move is unavailable right now.',
    renderError: 'The pool table could not load in this browser.',
  },
  ar: {
    title: 'بلياردو ٨ كرات', intro: 'اتدرّب على ضربة البداية أو العب مع صاحبك أونلاين.', city: 'ارجع للمدينة',
    language: 'اللغة', solo: 'تدريب', multiplayer: 'العب أونلاين', back: 'رجوع',
    create: 'أنشئ غرفة', join: 'انضم لغرفة', connect: 'ادخل اللعبة',
    restart: 'رتّب الكرات من جديد', rematch: 'العب مرة تانية', menu: 'القائمة', mute: 'اكتم الصوت', unmute: 'شغّل الصوت',
    hostHint: 'شارك رمز الغرفة مع أي زول في المدينة.', joinHint: 'رمز الغرفة',
    aimHint: 'اسحب من الكرة البيضاء لورا وفك عشان تضرب.',
    keyboardHint: 'استخدم الأسهم للتوجيه وضبط القوة، واضغط المسافة عشان تضرب.',
    keyboardPlace: 'استخدم الأسهم لتحريك الكرة البيضاء، واضغط المسافة عشان تثبّتها.',
    tableLabel: 'طاولة البلياردو', power: 'القوة',
    shots: 'الضربات', potted: 'دخلت', you: 'إنت', rival: 'الخصم', solids: 'السادة', stripes: 'المخططة',
    openTable: 'المجموعات لسه ما اتحددت', yourTurn: 'دورك', rivalTurn: 'دور الخصم', shooting: 'الكرات بتتحرك',
    ballInHand: 'الكرة في يدك', placeCueHint: 'المس أي مكان فاضي في الطاولة عشان تحط الكرة البيضاء.',
    badPlacement: 'اختار مكان بعيد من الحواف والجيوب والكرات التانية.',
    accept: 'تأكيد', reject: 'إلغاء', confirmRestart: 'تبدأ تدريب جديد؟', confirmExit: 'تطلع من اللعبة دي؟',
    rivalLeft: 'الخصم طلع من الغرفة.', won: 'فزت', lost: 'خسرت',
    soloDone: 'دخلت كل الكرات', connecting: 'جاري الاتصال…', waiting: 'في انتظار اللاعب التاني…',
    closed: 'الاتصال اتقفل. افتح اللعب أونلاين وحاول تاني.',
    sessionExpired: 'جلسة المدينة انتهت. ارجع للمدينة وسجّل دخولك.',
    notFound: 'الغرفة دي غير متاحة. اتأكد من الرمز أو اطلب رمز جديد.',
    code4: 'اكتب رمز الغرفة من ٤ خانات.',
    serverBusy: 'اللعب أونلاين مشغول. حاول تاني بعد شوية.',
    moveRejected: 'الحركة دي ما متاحة هسع.',
    renderError: 'الطاولة ما قدرت تفتح في المتصفح دا.',
  },
};

const initialLanguage = new URLSearchParams(window.location.search).get('lang');
let lang = initialLanguage === 'ar' ? 'ar' : 'en';

export function getLang() { return lang; }
export function t(key) { return strings[lang][key] ?? key; }

export function setLang(next) {
  lang = next === 'ar' ? 'ar' : 'en';
  const url = new URL(window.location.href);
  url.searchParams.set('lang', lang);
  window.history.replaceState(null, '', url);
  applyStatic();
}

export function applyStatic() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-label]').forEach((node) => node.setAttribute('aria-label', t(node.dataset.i18nLabel)));
  document.querySelectorAll('[data-lang]').forEach((button) => button.setAttribute('aria-pressed', button.dataset.lang === lang));
}
