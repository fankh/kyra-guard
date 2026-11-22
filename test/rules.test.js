import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BUILTIN_RULES, activeRules, compileCustomRule, keywordRegex, luhn, maskText, scanText, tooSlow, validBusinessNumber,
} from '../extension/lib/rules.js';

const defaults = activeRules({});
const all = activeRules({ rules: Object.fromEntries(BUILTIN_RULES.map((r) => [r.id, 'warn'])) });
const ids = (text, rules = all) => scanText(text, rules).findings.map((f) => f.id);

describe('built-in rules', () => {
  it('finds a resident registration number, also next to Korean text', () => {
    assert.deepEqual(ids('주민번호는 900101-1234567입니다'), ['kr-resident-number']);
    assert.deepEqual(ids('9001011234567'), ['kr-resident-number']);
    assert.deepEqual(ids('foreigner 900101-5234567'), ['kr-foreigner-number']);
  });

  it('does not take a number with an impossible date, or part of a longer number', () => {
    assert.deepEqual(ids('order 901301-1234567'), []);
    assert.deepEqual(ids('900132-1234567'), []);
    assert.deepEqual(ids('19001011234567890'), []);
  });

  it('finds a payment card number only when its check digit is right', () => {
    assert.deepEqual(ids('card 4111 1111 1111 1111 exp 12/29'), ['payment-card']);
    assert.deepEqual(ids('card 4111-1111-1111-1112'), []);
    assert.equal(luhn('4111111111111111'), true);
    assert.equal(luhn('1234'), false);
  });

  it('finds phone, passport, licence and business numbers', () => {
    assert.deepEqual(ids('연락처 010-1234-5678'), ['kr-mobile-phone']);
    assert.deepEqual(ids('passport M12345678'), ['kr-passport']);
    assert.deepEqual(ids('면허 11-23-123456-78'), ['kr-driver-licence']);
    assert.equal(validBusinessNumber('1248100998'), true);
    assert.deepEqual(ids('사업자번호 124-81-00998'), ['kr-business-number']);
    assert.deepEqual(ids('사업자번호 124-81-00999'), []);
  });

  it('finds keys, tokens and written-out passwords', () => {
    assert.deepEqual(ids('-----BEGIN RSA PRIVATE KEY-----\nMIIE'), ['private-key']);
    assert.deepEqual(ids('-----BEGIN PRIVATE KEY-----'), ['private-key']);
    assert.deepEqual(ids('aws AKIAIOSFODNN7EXAMPLE here'), ['aws-access-key']);
    assert.deepEqual(ids(`token ghp_${'a1B2'.repeat(9)}`), ['api-token']);
    assert.deepEqual(ids(`key sk-proj-${'x'.repeat(30)}`), ['api-token']);
    assert.deepEqual(ids('비밀번호: hunter2!!'), ['password-assignment']);
    assert.deepEqual(ids('Password = s3cretValue'), ['password-assignment']);
    assert.deepEqual(ids('the task-list is long, ask-me later'), []);
  });

  it('leaves e-mail addresses and business numbers alone unless they are turned on', () => {
    assert.deepEqual(ids('mail kim@example.com, 사업자 124-81-00998', defaults), []);
    assert.deepEqual(ids('mail kim@example.com'), ['email-address']);
  });

  it('blocks when any finding blocks, warns otherwise, and counts what it found', () => {
    assert.equal(scanText('plain text', defaults).action, 'allow');
    assert.equal(scanText('call 010-1234-5678', defaults).action, 'warn');
    const both = scanText('010-1234-5678 and 010-9999-0000 and 900101-1234567', defaults);
    assert.equal(both.action, 'block');
    assert.equal(both.findings.find((f) => f.id === 'kr-mobile-phone').count, 2);
    assert.ok(!JSON.stringify(both.findings).includes('1234567'), 'findings never hold the text');
  });

  it('applies the settings: a rule can be turned off or changed', () => {
    const rules = activeRules({ rules: { 'kr-resident-number': 'off', 'kr-mobile-phone': 'block', 'email-address': 'bogus' } });
    assert.equal(rules.some((r) => r.id === 'kr-resident-number'), false);
    assert.equal(rules.find((r) => r.id === 'kr-mobile-phone').action, 'block');
    assert.equal(rules.some((r) => r.id === 'email-address'), false, 'an unknown choice keeps the default (off)');
  });
});

describe('own rules', () => {
  const found = (pattern, text) => [...text.matchAll(keywordRegex(pattern))].map((m) => m[0]);

  it('matches a Korean keyword alone and with a particle attached', () => {
    assert.deepEqual(found('대외비', '이 문서는 대외비 입니다'), ['대외비']);
    assert.deepEqual(found('대외비', '대외비를 보내지 마세요'), ['대외비']);
    assert.deepEqual(found('機密', 'これは機密です'), ['機密']);
  });

  it('matches an English keyword as a whole word, in any letter case', () => {
    assert.deepEqual(found('secret', 'the Secret plan'), ['Secret']);
    assert.deepEqual(found('secret', 'secretary and topsecrets'), []);
    assert.deepEqual(found('apollo, 대외비', 'apollo계획은 대외비'), ['apollo', '대외비']);
    assert.deepEqual(found('a.b', 'aXb a.b'), ['a.b'], 'punctuation in a keyword is literal');
    assert.equal(keywordRegex(' , '), null);
  });

  it('refuses a rule that is incomplete, invalid, matches nothing or is slow', () => {
    assert.equal(compileCustomRule({ name: '', pattern: 'x' }).error, 'name');
    assert.equal(compileCustomRule({ name: 'n', pattern: ' ' }).error, 'pattern');
    assert.equal(compileCustomRule({ name: 'n', type: 'regex', pattern: 'a'.repeat(501) }).error, 'tooLong');
    assert.equal(compileCustomRule({ name: 'n', type: 'regex', pattern: '(' }).error, 'invalid');
    assert.equal(compileCustomRule({ name: 'n', type: 'regex', pattern: 'a*' }).error, 'empty');
    assert.equal(compileCustomRule({ name: 'n', type: 'regex', pattern: '(a+)+$' }).error, 'slow');
    assert.equal(tooSlow(/PRJ-\d{4}/g), false);
  });

  it('runs an own rule with the built-in ones', () => {
    const rules = activeRules({
      customRules: [
        { id: 'custom-a', name: 'Project code', type: 'regex', pattern: 'PRJ-\\d{4}', action: 'block' },
        { id: 'custom-b', name: 'Internal', type: 'keyword', pattern: '대외비, confidential', action: 'warn' },
        { id: 'custom-c', name: 'Broken', type: 'regex', pattern: '(', action: 'block' },
        { id: 'custom-d', name: 'Off', type: 'keyword', pattern: 'x', action: 'off' },
      ],
    });
    const result = scanText('PRJ-2041 is Confidential, 대외비임', rules);
    assert.equal(result.action, 'block');
    assert.deepEqual(result.findings.map((f) => [f.id, f.category, f.count]), [['custom-a', 'CUSTOM', 1], ['custom-b', 'CUSTOM', 2]]);
  });
});

describe('masking', () => {
  it('replaces each finding with the name of its rule', () => {
    const text = 'call 010-1234-5678 or mail kim@example.com';
    const { spans } = scanText(text, all);
    assert.equal(maskText(text, spans), 'call [Mobile phone number (KR)] or mail [E-mail address]');
    assert.equal(maskText(text, spans, (rule) => rule.nameKo), 'call [휴대전화번호] or mail [이메일 주소]');
  });

  it('covers overlapping findings once and leaves nothing of them behind', () => {
    const text = 'password: 010-1234-5678 end';
    const { spans, findings } = scanText(text, all);
    assert.equal(findings.length, 2);
    const masked = maskText(text, spans);
    assert.equal(masked, '[Password written out] end');
    assert.equal(scanText(masked, all).action, 'allow', 'the masked text passes the same rules');
  });
});
