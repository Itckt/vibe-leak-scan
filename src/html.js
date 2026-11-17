import { parse } from 'parse5';

function walk(node, visit) {
  visit(node);
  // Template and noscript contents are not browser-loaded script resources.
  if (node.tagName === 'template' || node.tagName === 'noscript') return;
  for (const child of node.childNodes || []) walk(child, visit);
}

function attributes(node) {
  return Object.fromEntries((node.attrs || []).map(({ name, value }) => [name, value]));
}

export function readHtml(html, pageUrl) {
  const document = parse(html);
  const scripts = [];
  const inline = [];
  const modulepreloads = [];
  const meta = { csp: [], referrer: [] };
  let baseUrl = pageUrl;
  let hasBase = false;
  walk(document, (node) => {
    if (node.tagName === 'meta' && node.parentNode?.tagName === 'head') {
      const attrs = attributes(node);
      if (attrs['http-equiv']?.toLowerCase() === 'content-security-policy') meta.csp.push(attrs.content || '');
      if (attrs.name?.toLowerCase() === 'referrer') meta.referrer.push(attrs.content || '');
    }
    if (node.tagName === 'link') {
      const attrs = attributes(node);
      if ((attrs.rel || '').toLowerCase().split(/\s+/).includes('modulepreload') && attrs.href) modulepreloads.push(attrs.href);
    }
    if (node.tagName === 'base' && !hasBase) {
      const { href } = attributes(node);
      if (href) {
        try { baseUrl = new URL(href, pageUrl).href; hasBase = true; } catch { /* Ignore invalid bases. */ }
      }
    }
    if (node.tagName === 'script') {
      const { src } = attributes(node);
      if (src) scripts.push(src);
      else inline.push((node.childNodes || []).map((child) => child.value || '').join(''));
    }
  });
  return {
    inline, meta, baseUrl,
    modulepreloads: [...new Set(modulepreloads.flatMap((href) => {
      try { return [new URL(href, baseUrl).href]; } catch { return []; }
    }))],
    scripts: [...new Set(scripts.flatMap((src) => {
      try { return [new URL(src, baseUrl).href]; } catch { return []; }
    }))],
  };
}

export function hasVerificationMeta(html, token) {
  const document = parse(html);
  let matched = false;
  walk(document, (node) => {
    if (node.tagName !== 'head') return;
    for (const child of node.childNodes || []) {
      if (child.tagName !== 'meta') continue;
      const attrs = attributes(child);
      if (attrs.name === 'laumlau-verify' && attrs.content === token) matched = true;
    }
  });
  return matched;
}

export function isHtml(body, contentType = '') {
  return /(?:text\/html|application\/xhtml\+xml)/i.test(contentType)
    || /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(body);
}
