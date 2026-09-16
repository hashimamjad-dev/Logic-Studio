/**
 * Tiny DOM helpers.
 *
 * The panels are plain DOM rather than a framework: the workspace is a canvas, the
 * panels are a few hundred elements, and a build with no runtime dependencies is
 * easier to package offline later.
 */

type Attrs = Record<string, string | number | boolean | undefined | EventListener>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function icon(path: string, size = 16): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

/** Icon paths, drawn here rather than pulled from an icon font. */
export const ICONS = {
  cursor: 'M4 3l7 17 2.5-6.5L20 11z',
  marquee: 'M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3',
  file: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  save: 'M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8',
  undo: 'M3 10h11a5 5 0 010 10h-3M3 10l5-5M3 10l5 5',
  redo: 'M21 10H10a5 5 0 000 10h3M21 10l-5-5M21 10l-5 5',
  play: 'M6 4l14 8-14 8z',
  pause: 'M8 5v14M16 5v14',
  step: 'M6 4l10 8-10 8zM19 4v16',
  reset: 'M3 12a9 9 0 109-9 9 9 0 00-6.4 2.7L3 8M3 3v5h5',
  wave: 'M2 12h3l2-6 3 12 3-9 2 4h7',
  table: 'M3 5h18v14H3zM3 10h18M9 10v9M15 10v9',
  help: 'M12 17h.01M9.1 9a3 3 0 015.8 1c0 2-3 2.5-3 4M12 21a9 9 0 110-18 9 9 0 010 18z',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M6 6L4.5 4.5M19.5 19.5L18 18M6 18l-1.5 1.5M19.5 4.5L18 6M16 12a4 4 0 11-8 0 4 4 0 018 0z',
  moon: 'M21 13A9 9 0 1111 3a7 7 0 0010 10z',
  rotate: 'M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006 6.6L4 10M4 15a8 8 0 0014 2.4L20 14',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13M9 7V4h6v3',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  zoomIn: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3M11 8v6M8 11h6',
  zoomOut: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3M8 11h6',
  fit: 'M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4',
  chip: 'M7 7h10v10H7zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
  export: 'M12 15V3M12 3L8 7M12 3l4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2',
};
