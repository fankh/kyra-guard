// Admin page of the management server: shows the settings in force and replaces them with a
// document saved from the extension's own settings page.

const TEXT = {
  en: {
    title: 'KYRA AI Guardrail Free: management server',
    intro: 'Every browser connected to this server downloads the settings below and checks in with its name, versions and daily counts. The server is never told a site, a rule, a file name or what anyone typed.',
    browsers: 'Connected browsers',
    browsersHelp: 'The last check-in of each browser. Counts are for the last 7 days: blocked, warned, and sent after a warning. They come from each browser\'s own activity log, which keeps 500 events; a dash means the log is off there.',
    browsersTotal: '$1 browsers: $2 on the current settings, $3 not seen for 7 days.',
    browsersNone: 'No browser has checked in yet.',
    colName: 'Browser',
    colVersion: 'Extension',
    colSettings: 'Settings',
    colChecks: 'Checks',
    colLastSeen: 'Last seen',
    colWeek: 'Last 7 days',
    weekValue: '$1 blocked, $2 warned, $3 sent anyway',
    current: 'current',
    behind: 'behind',
    quiet: 'not seen for 7 days',
    waiting: '$1 own services waiting for site access',
    noName: '(no name)',
    remove: 'Remove',
    confirmRemove: 'Remove this browser from the list? It appears again at its next check-in if it is still connected.',
    refreshList: 'Refresh the list',
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
    errTooMany: 'Too many wrong attempts. Check the admin key and try again.',
    errJson: 'The document is not valid JSON.',
    errServer: 'The server did not accept the request.',
  },
  ko: {
    title: 'KYRA AI Guardrail Free: 관리 서버',
    intro: '본 서버에 연결된 모든 브라우저가 아래 설정을 내려받고 이름, 버전, 일별 건수를 보고합니다. 서버는 사이트, 규칙, 파일 이름, 입력 내용을 수신하지 않습니다.',
    browsers: '연결된 브라우저',
    browsersHelp: '브라우저별 최근 보고 내용입니다. 건수는 최근 7일 기준이며 차단, 경고, 경고 후 전송 순입니다. 각 브라우저의 활동 기록(최대 500건)에서 집계하며, 줄표는 해당 브라우저의 기록 사용 중지를 의미합니다.',
    browsersTotal: '브라우저 $1대: 현재 설정 적용 $2대, 7일간 미접속 $3대.',
    browsersNone: '보고한 브라우저가 없습니다.',
    colName: '브라우저',
    colVersion: '확장 프로그램',
    colSettings: '설정',
    colChecks: '검사',
    colLastSeen: '최근 접속',
    colWeek: '최근 7일',
    weekValue: '차단 $1, 경고 $2, 경고 후 전송 $3',
    current: '현재 버전',
    behind: '이전 버전',
    quiet: '7일간 미접속',
    waiting: '사이트 접근 대기 중인 직접 추가 서비스 $1개',
    noName: '(이름 없음)',
    remove: '삭제',
    confirmRemove: '이 브라우저를 목록에서 삭제하시겠습니까? 연결 상태인 경우 다음 보고 시 다시 표시됩니다.',
    refreshList: '목록 새로 고침',
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
    errTooMany: '잘못된 시도가 많습니다. 관리자 키를 확인한 후 다시 시도하십시오.',
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
  // Relative to the page, so the server also works behind a reverse proxy under a path prefix.
  const response = await fetch(new URL(path, document.baseURI), {
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

const WEEK_MS = 7 * 86400000;

function cell(text, small) {
  const td = document.createElement('td');
  td.textContent = text;
  if (small) {
    const note = document.createElement('small');
    note.textContent = small;
    td.append(note);
  }
  return td;
}

async function showBrowsers() {
  const list = await call('GET', 'api/admin/browsers');
  if (!list) return;
  const body = $('browsers').tBodies[0];
  const when = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  let current = 0;
  let quiet = 0;
  body.replaceChildren(...list.browsers.map((browser) => {
    const isCurrent = browser.settingsVersion === list.version;
    const isQuiet = Date.now() - new Date(browser.lastSeen).getTime() > WEEK_MS;
    current += isCurrent;
    quiet += isQuiet;
    const row = document.createElement('tr');
    const name = cell(browser.label || t('noName'), browser.id.slice(0, 8));
    const seen = cell(when.format(new Date(browser.lastSeen)));
    if (isQuiet) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = t('quiet');
      seen.append(document.createElement('br'), tag);
    }
    const sum = (key) => browser.days.reduce((total, day) => total + day[key], 0);
    const week = browser.days ? t('weekValue', [sum('blocked'), sum('warned'), sum('sentAfterWarning')]) : '—';
    const checks = cell(t('checksValue', [t(browser.checks.prompts ? 'on' : 'off'), t(browser.checks.files ? 'on' : 'off')]),
      browser.pendingAccess ? t('waiting', [browser.pendingAccess]) : '');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = t('remove');
    remove.addEventListener('click', async () => {
      if (!confirm(t('confirmRemove'))) return;
      await call('DELETE', `api/admin/browsers/${encodeURIComponent(browser.id)}`);
      showBrowsers();
    });
    const action = document.createElement('td');
    action.append(remove);
    row.append(name, cell(browser.extensionVersion), cell(t(isCurrent ? 'current' : 'behind'), browser.settingsVersion ?? ''), checks, seen, cell(week), action);
    return row;
  }));
  $('browsers').parentElement.hidden = list.browsers.length === 0;
  $('browsers-total').textContent = list.browsers.length ? t('browsersTotal', [list.browsers.length, current, quiet]) : t('browsersNone');
}

function show(state) {
  $('sign-in').hidden = Boolean(state);
  $('console').hidden = !state;
  if (!state) return;
  showBrowsers();
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
  $('address').textContent = new URL('.', document.baseURI).href;
  $('enrollment-key').textContent = state.enrollmentKey;
  $('refresh').value = state.refreshMinutes;
  $('document').value = JSON.stringify(settings, null, 2);
}

$('sign-in-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  sessionStorage.setItem(KEY, $('admin-key').value.trim());
  $('admin-key').value = '';
  show(await call('GET', 'api/admin/state'));
});

$('sign-out').addEventListener('click', () => {
  sessionStorage.removeItem(KEY);
  show(null);
});

$('refresh-browsers').addEventListener('click', showBrowsers);
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
  const state = await call('PUT', 'api/admin/settings', { settings, refreshMinutes: Number($('refresh').value) });
  if (!state) return undefined;
  show(state);
  const { ownServices, ownRules } = state.dropped;
  $('message').textContent = ownServices || ownRules ? t('savedDropped', [ownServices, ownRules]) : t('saved');
  return undefined;
});

$('rotate').addEventListener('click', async () => {
  if (!confirm(t('confirmRotate'))) return;
  const state = await call('POST', 'api/admin/enrollment-key');
  if (state) show(state);
});

if (sessionStorage.getItem(KEY)) show(await call('GET', 'api/admin/state'));
