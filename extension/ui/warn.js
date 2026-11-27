// warn.html: shown in place of a navigation to an AI service the company has not reviewed.
// The user can go back, or continue with a reason; continuing allows the service for an
// hour and reports the reason.

import { continueUrl, parseRedirectParams } from '../lib/pageparams.js';
import { MAX_REASON_LENGTH } from '../lib/reporter.js';
import { ask, goBack, localize, lookupService, setText, t } from './common.js';

const PROCEED_MINUTES = 60;

localize();

const { serviceId, host, url } = parseRedirectParams(location.href);
const target = continueUrl(url, host);
// Only ever shown as a whole tab (the warning is for top-level navigations): inside another
// site's frame the page could be covered up to steer the user's clicks, so it shows nothing.
const framed = window.top !== window;
const { companyName, service } = framed ? {} : await lookupService(serviceId, host);

if (framed) {
  document.body.replaceChildren();
} else if (service?.action === 'allow' && target) {
  // The policy may have changed since the redirect; an allowed service needs no warning.
  location.replace(target);
} else {
  render();
}

function render() {
  const serviceName = service?.name ?? t('unknownService');
  const company = companyName || t('yourCompany');
  setText('service-name', service?.vendor ? `${service.name} (${service.vendor})` : serviceName);
  setText('host', host ?? '—');
  setText('company', company);
  setText('body', t('warnBody', [serviceName, company]));
  setText('notice', t('warnNotice', [String(PROCEED_MINUTES)]));

  const reason = document.getElementById('reason');
  const button = document.getElementById('continue');
  const error = document.getElementById('error');
  reason.maxLength = MAX_REASON_LENGTH;

  const update = () => {
    setText('counter', t('reasonCounter', [String(reason.value.length), String(MAX_REASON_LENGTH)]));
    button.disabled = !target || reason.value.trim().length === 0;
  };
  reason.addEventListener('input', update);
  update();

  document.getElementById('back').addEventListener('click', goBack);
  document.getElementById('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = reason.value.trim();
    if (!text || !target) return;
    button.disabled = true;
    error.hidden = true;
    const response = await ask({ type: 'proceed', serviceId, host, url: target, reason: text });
    if (response?.ok && response.url) {
      location.replace(response.url);
    } else {
      error.textContent = t('proceedFailed');
      error.hidden = false;
      update();
    }
  });

  if (host) ask({ type: 'warned', host });
  reason.focus();
}
