"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "@/shared/store/locale";
import { AUTO_TRANSLATIONS } from "./autoTranslations";

const ATTRS = ["placeholder", "title", "aria-label"] as const;

function translateText(text: string, dict: Record<string, string>): string {
  const trimmed = text.trim();
  if (!trimmed) return text;

  // Exact match first, preserving white-space around the text
  if (dict[trimmed]) {
    return text.replace(trimmed, dict[trimmed]);
  }

  // Safe phrase substitution for combined labels, longest first
  let next = text;
  Object.keys(dict)
    .sort((a, b) => b.length - a.length)
    .forEach((key) => {
      if (next.includes(key)) next = next.replaceAll(key, dict[key]);
    });
  return next;
}

/**
 * Translates server-rendered static UI after hydration.
 * It deliberately avoids script/style inputs and translates only known Russian phrases,
 * so customer names, product names, messages, and values stay intact.
 */
export function AutoTranslator() {
  const { locale } = useLocale();
  const originalRef = useRef(new WeakMap<Node, string>());
  const attrOriginalRef = useRef(new WeakMap<Element, Map<string, string>>());

  useEffect(() => {
    document.documentElement.lang = locale;
    const dict = locale === "ru" ? null : AUTO_TRANSLATIONS[locale];

    const skip = (el: Element | null) => {
      if (!el) return true;
      const tag = el.tagName;
      return ["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA", "INPUT", "OPTION", "SELECT"].includes(tag) ||
        el.closest("[data-no-translate]") !== null;
    };

    const walk = () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) nodes.push(node as Text);

      nodes.forEach((textNode) => {
        if (skip(textNode.parentElement)) return;
        const current = textNode.nodeValue ?? "";
        if (!originalRef.current.has(textNode)) originalRef.current.set(textNode, current);
        const original = originalRef.current.get(textNode) ?? current;
        textNode.nodeValue = dict ? translateText(original, dict) : original;
      });

      document.querySelectorAll<HTMLElement>("*").forEach((el) => {
        if (skip(el)) return;
        let originals = attrOriginalRef.current.get(el);
        if (!originals) {
          originals = new Map<string, string>();
          attrOriginalRef.current.set(el, originals);
        }
        ATTRS.forEach((attr) => {
          const value = el.getAttribute(attr);
          if (!value) return;
          if (!originals!.has(attr)) originals!.set(attr, value);
          const original = originals!.get(attr) ?? value;
          el.setAttribute(attr, dict ? translateText(original, dict) : original);
        });
      });
    };

    walk();
    const observer = new MutationObserver(() => walk());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [locale]);

  return null;
}
