// Admin page of the management server: shows the settings in force and replaces them with a
// document saved from the extension's own settings page.

const TEXT = {
  en: {
    title: 'KYRA AI Guardrail Free: management server',
    intro: 'Every browser connected to this server downloads the settings below. The server hands out settings only: it receives nothing about people or what they send, and keeps no record of who asked.',
    signIn: 'Sign in',
    adminKey: 'Admin key',
    open: 'Open',
    signInHelp: 'The admin key was shown once when the server first started. To make a new one, run the server with --reset-admin-key.',
    inForce: 'Settings in force',
    version: 'Version',
    updated: 'Last changed',
    organisation: 'Organization',
    services: 'AI services',
    servicesValue: '$1 in all: $2 blocked, $3 warned, $4 allowed ($5 own)',
    rules: 'Data rules in force',
    rulesValue: '$1 ($2 own)',
    checks: 'Checks',
    checksValue: 'messages $1, files $2',
    on: 'on',
    off: 'off',
    connect: 'Connecting browsers',
    connectHelp: 'In the extension settings, under "Management server", enter this address and key. An administrator can also push them through browser policy as serverUrl and serverKey.',
    serverAddress: 'Server address',
    enrollmentKey: 'Enrollment key',
    rotate: 'Make a new enrollment key',
    confirmRotate: 'Make a new enrollment key? Browsers connected with the old key stop downloading until they are given the new one. They keep the settings they have.',
    change: 'Change the settings',
    changeHelp: 'Set things up in your own browser with the extension, choose "Save settings to a file" there, and load that file here. You can also edit the document below.',
    pick: 'Load a settings file',
    refresh: 'Browsers check every (minutes)',
    save: 'Save and hand out',
    signOut: 'Sign out',
    saved: 'Saved. Browsers pick it up at their next check.',
    savedDropped: 'Saved, but $1 own services and $2 own rules in the document could not be used and were left out.',
    errUnauthorized: 'The admin key was not accepted.',
    errTooMany: 'Too many wrong attempts. Try again in ten minutes.',
    errJson: 'The document is not valid JSON.',
    errServer: 'The server did not accept the request.',
  },
  ko: {
    title: 'KYRA AI Guardrail Free: 관리 서버',
    intro: '본 서버에 연결된 모든 브라우저가 아래 설정을 내려받습니다. 서버는 설정만 배포하며 사용자 정보와 입력 내용을 수신하지 않고 요청 기록을 보관하지 않습니다.',
    signIn: '로그인',
    adminKey: '관리자 키',
    open: '열기',
    signInHelp: '관리자 키는 서버 최초 실행 시 한 번 표시되었습니다. 새 키가 필요한 경우 --reset-admin-key 옵션으로 서버를 실행하십시오.',
    inForce: '적용 중인 설정',
    version: '버전',
    updated: '최근 변경',
    organisation: '조직',
    services: 'AI 서비스',
    servicesValue: '전체 $1개: 차단 $2, 경고 $3, 허용 $4 (직접 추가 $5)',
    rules: '적용 중인 데이터 규칙',
    rulesValue: '$1개 (사용자 규칙 $2)',
    checks: '검사',
    checksValue: '메시지 $1, 파일 $2',
    on: '사용',
    off: '사용 안 함',
    connect: '브라우저 연결',
    connectHelp: '확장 프로그램 설정의 "관리 서버"에 아래 주소와 키를 입력하십시오. 관리자는 브라우저 정책의 serverUrl, serverKey 값으로 배포할 수도 있습니다.',
    serverAddress: '서버 주소',
    enrollmentKey: '등록 키',
    rotate: '등록 키 새로 만들기',
    confirmRotate: '등록 키를 새로 만드시겠습니까? 기존 키로 연결된 브라우저는 새 키를 입력할 때까지 내려받기가 중단되며 보유 중인 설정은 유지됩니다.',
    change: '설정 변경',
    changeHelp: '확장 프로그램이 설치된 브라우저에서 설정을 구성한 후 "설정을 파일로 저장"으로 만든 파일을 여기에서 불러오십시오. 아래 문서를 직접 수정할 수도 있습니다.',
    pick: '설정 파일 불러오기',
    refresh: '브라우저 확인 주기(분)',
    save: '저장 및 배포',
    signOut: '로그아웃',
    saved: '저장되었습니다. 브라우저는 다음 확인 시 반영합니다.',
    savedDropped: '저장되었으나 문서의 직접 추가 서비스 $1개와 사용자 규칙 $2개는 사용할 수 없어 제외되었습니다.',
    errUnauthorized: '관리자 키가 승인되지 않았습니다.',
    errTooMany: '잘못된 시도가 많습니다. 10분 후 다시 시도하십시오.',
    errJson: '문서가 올바른 JSON 형식이 아닙니다.',
    errServer: '서버에서 요청이 승인되지 않았습니다.',
  },
};

const lang = navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
const t = (key, values = []) => TEXT[lang][key].replace(/\$([1-9])/g, (_, n) => String(values[n - 1] ?? ''));
const $ = (id) => document.getElementById(id);
const KEY = 'kyraAdminKey';

document.documentElement.lang = lang;
document.title = t('title');
for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
for (const el of document.querySelectorAll('[data-t-placeholder]')) el.placeholder = t(el.dataset.tPlaceholder);
for (const el of document.querySelectorAll('[data-t-label]')) el.setAttribute('aria-label', t(el.dataset.tLabel));

function showError(text) {
  $('error').textContent = text;
  $('error').hidden = !text;
}

/** Calls the admin API with the key of this tab; null when the call was refused. */
async function call(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${sessionStorage.getItem(KEY) ?? ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.ok) {
    showError('');
    return response.json();
  }
  if (response.status === 401 || response.status === 429) {
    sessionStorage.removeItem(KEY);
    show(null);
  }
  showError(t(response.status === 401 ? 'errUnauthorized' : response.status === 429 ? 'errTooMany' : 'errServer'));
  return null;
}

function show(state) {
  $('sign-in').hidden = Boolean(state);
  $('console').hidden = !state;
  if (!state) return;
  const { summary, settings } = state;
  const onOff = (value) => t(value ? 'on' : 'off');
  const rows = [
    [t('version'), state.version],
    [t('updated'), new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.updatedAt))],
    [t('organisation'), settings.organisation || '—'],
    [t('services'), t('servicesValue', [summary.services, summary.blocked, summary.warned, summary.allowed, summary.ownServices])],
    [t('rules'), t('rulesValue', [summary.rulesInForce, summary.ownRules])],
    [t('checks'), t('checksValue', [onOff(settings.inspection.prompts), onOff(settings.inspection.files)])],
  ];
  $('summary').replaceChildren(...rows.flatMap(([name, value]) => {
    const term = document.createElement('dt');
    term.textContent = name;
    const detail = document.createElement('dd');
    detail.textContent = value;
    return [term, detail];
  }));
  $('address').textContent = `${location.origin}/`;
  $('enrollment-key').textContent = state.enrollmentKey;
  $('refresh').value = state.refreshMinutes;
  $('document').value = JSON.stringify(settings, null, 2);
}

$('sign-in-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  sessionStorage.setItem(KEY, $('admin-key').value.trim());
  $('admin-key').value = '';
  show(await call('GET', '/api/admin/state'));
});

$('sign-out').addEventListener('click', () => {
  sessionStorage.removeItem(KEY);
  show(null);
});

$('pick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  event.target.value = '';
  if (file) $('document').value = await file.text();
});

$('save').addEventListener('click', async () => {
  let settings;
  try {
    settings = JSON.parse($('document').value);
  } catch {
    settings = null;
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return showError(t('errJson'));
  const state = await call('PUT', '/api/admin/settings', { settings, refreshMinutes: Number($('refresh').value) });
  if (!state) return undefined;
  show(state);
  const { ownServices, ownRules } = state.dropped;
  $('message').textContent = ownServices || ownRules ? t('savedDropped', [ownServices, ownRules]) : t('saved');
  return undefined;
});

$('rotate').addEventListener('click', async () => {
  if (!confirm(t('confirmRotate'))) return;
  const state = await call('POST', '/api/admin/enrollment-key');
  if (state) show(state);
});

if (sessionStorage.getItem(KEY)) show(await call('GET', '/api/admin/state'));
