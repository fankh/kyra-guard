// blocked.html: shown in place of a navigation to a blocked AI service.

import { parseRedirectParams } from '../lib/pageparams.js';
import { ask, goBack, localize, lookupService, setText, t } from './common.js';

const framed = window.top !== window;
document.body.classList.toggle('framed', framed);
localize();

const { serviceId, host } = parseRedirectParams(location.href);
const { companyName, service } = await lookupService(serviceId, host);
const serviceName = service?.name ?? t('unknownService');
const company = companyName || t('yourCompany');

setText('service-name', service?.vendor ? `${service.name} (${service.vendor})` : serviceName);
setText('host', host ?? '—');
setText('company', company);
setText('body', t('blockedBody', [serviceName, company]));
document.getElementById('back').addEventListener('click', goBack);

// Only top-level navigations are reported; a blocked iframe is not a visit by the user.
if (!framed && host) ask({ type: 'blocked', host });

// An edition may add to this page (asking for an exception, where the edition has that);
// its worker says so. Where it has nothing to add, the question simply goes unanswered.
if (!framed && (await ask({ type: 'blockedExtras' }))?.enabled) {
  import('./blocked-extra.js').then((extra) => extra.default({ serviceId, host })).catch(() => {});
}
