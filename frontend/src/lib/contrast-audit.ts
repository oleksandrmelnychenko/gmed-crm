/** Measures WCAG contrast of what is on screen: text 4.5:1 (large 3:1), icons and field borders 3:1. */
export type Rgba = [number, number, number, number];
export type ContrastKind = "text" | "icon" | "border" | "placeholder";
export type ContrastFinding = {
  kind: ContrastKind;
  ratio: number;
  required: number;
  /** Disabled controls are exempt in WCAG; they are reported separately. */
  disabled: boolean;
  element: Element;
  label: string;
  foreground: string;
  background: string;
};

/** Elements inside this attribute (the meter's own panel) are never measured. */
export const CONTRAST_METER_IGNORE = "data-contrast-meter";
const MAX_FINDINGS = 200;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const encode = (linear: number) => 255 * clamp(linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055);

function oklabToRgb(l: number, a: number, b: number): [number, number, number] {
  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    encode(4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc),
    encode(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc),
    encode(-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc),
  ];
}

const number = (part: string, scale = 1) => part.endsWith("%") ? (parseFloat(part) / 100) * scale : parseFloat(part);

/** Parses the colour forms browsers return from getComputedStyle. */
export function parseCssColor(value: string): Rgba | null {
  const input = value.trim().toLowerCase();
  if (input === "transparent") return [0, 0, 0, 0];
  const hex = input.match(/^#([\da-f]{3,8})$/);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) digits = [...digits].map((digit) => digit + digit).join("");
    const channels = digits.match(/../g)!.map((pair) => parseInt(pair, 16));
    return [channels[0], channels[1], channels[2], channels.length > 3 ? channels[3] / 255 : 1];
  }
  const fn = input.match(/^([a-z]+)\((.*)\)$/);
  if (!fn) return null;
  const [body, alphaPart] = fn[2].split("/").map((part) => part.trim());
  const parts = body.split(/[\s,]+/).filter(Boolean);
  let alpha = alphaPart ? number(alphaPart) : 1;
  switch (fn[1]) {
    case "rgb":
    case "rgba":
      if (parts.length === 4) alpha = number(parts[3]);
      return [number(parts[0], 255), number(parts[1], 255), number(parts[2], 255), clamp(alpha)];
    case "oklch": {
      const l = number(parts[0]), c = number(parts[1], 0.4), h = (parseFloat(parts[2]) || 0) * Math.PI / 180;
      return [...oklabToRgb(l, c * Math.cos(h), c * Math.sin(h)), clamp(alpha)];
    }
    case "oklab":
      return [...oklabToRgb(number(parts[0]), number(parts[1], 0.4), number(parts[2], 0.4)), clamp(alpha)];
    case "color":
      if (parts[0] !== "srgb") return null;
      return [number(parts[1]) * 255, number(parts[2]) * 255, number(parts[3]) * 255, clamp(alpha)];
    default:
      return null;
  }
}

function luminance([r, g, b]: Rgba): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export function contrast(a: Rgba, b: Rgba): number {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Paints `top` over an opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top[3];
  return [0, 1, 2].map((index) => top[index] * alpha + bottom[index] * (1 - alpha)).concat(1) as Rgba;
}

export const toHex = (color: Rgba) => `#${color.slice(0, 3).map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;

const WHITE: Rgba = [255, 255, 255, 1];
const FIELD_SELECTOR = "input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea, [data-slot=select-trigger]";

function isDisabled(element: Element) {
  return element.closest(":disabled, [aria-disabled=true], [data-disabled]") !== null;
}

function defaultVisible(element: Element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight &&
    rect.right > 0 && rect.left < window.innerWidth;
}

type Context = { style: (element: Element, pseudo?: string) => CSSStyleDeclaration };

/** The opaque colour behind an element and the opacity it is drawn with. */
function backdrop(element: Element, context: Context): { color: Rgba; opacity: number } {
  const layers: Rgba[] = [];
  let opacity = 1;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = context.style(node);
    opacity *= Number(style.opacity || 1);
    const color = parseCssColor(style.backgroundColor);
    if (color && color[3] > 0) {
      layers.push(color);
      if (color[3] >= 1) break;
    }
  }
  return { color: layers.reverse().reduce((base, layer) => composite(layer, base), WHITE), opacity };
}

function labelOf(element: Element): string {
  const text = [...element.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join(" ").trim();
  return (text || element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.tagName.toLowerCase()).slice(0, 60);
}

function iconName(svg: Element) {
  const lucide = [...svg.classList].find((name) => name.startsWith("lucide-") && name !== "lucide-icon");
  return lucide ? lucide.slice(7) : "svg";
}

export function auditContrast(root: ParentNode = document, options: { isVisible?: (element: Element) => boolean } = {}): ContrastFinding[] {
  const isVisible = options.isVisible ?? defaultVisible;
  const context: Context = { style: (element, pseudo) => getComputedStyle(element, pseudo) };
  const findings: ContrastFinding[] = [];
  const seen = new Set<string>();
  const report = (finding: Omit<ContrastFinding, "foreground" | "background">, foreground: Rgba, background: Rgba) => {
    // The same colours on the same label are one problem, not one per table row.
    const key = `${finding.kind}|${finding.label}|${toHex(foreground)}|${toHex(background)}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ ...finding, ratio: Math.round(finding.ratio * 100) / 100, foreground: toHex(foreground), background: toHex(background) });
  };

  for (const element of root.querySelectorAll("*")) {
    if (findings.length >= MAX_FINDINGS) break;
    const svg = element.closest("svg");
    if ((svg && svg !== element) || element.closest(`[${CONTRAST_METER_IGNORE}]`)) continue;
    const isIcon = element.tagName.toLowerCase() === "svg";
    const isField = element.matches(FIELD_SELECTOR);
    const hasText = [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim());
    if (!isIcon && !isField && !hasText) continue;
    const style = context.style(element);
    if (style.visibility === "hidden" || style.display === "none" || !isVisible(element)) continue;
    const disabled = isDisabled(element);

    if (isField) {
      const parent = element.parentElement ? backdrop(element.parentElement, context).color : WHITE;
      const border = parseCssColor(style.borderTopColor);
      if (border && parseFloat(style.borderTopWidth) > 0) {
        const painted = composite(border, parent);
        const ratio = contrast(painted, parent);
        if (ratio < 3) report({ kind: "border", ratio, required: 3, disabled, element, label: labelOf(element) }, painted, parent);
      }
      const placeholder = element.getAttribute("placeholder");
      if (placeholder && !(element as HTMLInputElement).value) {
        const own = backdrop(element, context).color;
        const color = parseCssColor(context.style(element, "::placeholder").color);
        if (color) {
          const painted = composite(color, own);
          const ratio = contrast(painted, own);
          if (ratio < 4.5) report({ kind: "placeholder", ratio, required: 4.5, disabled, element, label: placeholder.slice(0, 60) }, painted, own);
        }
      }
      if (!hasText) continue;
    }

    const { color: background, opacity } = backdrop(isIcon && element.parentElement ? element.parentElement : element, context);
    let ink = parseCssColor(style.color);
    if (isIcon) {
      const stroke = element.getAttribute("stroke");
      const fill = element.getAttribute("fill");
      const explicit = [stroke, fill].find((value) => value && value !== "none" && value !== "currentColor");
      if (explicit) ink = parseCssColor(explicit) ?? ink;
    }
    if (!ink) continue;
    const painted = composite([ink[0], ink[1], ink[2], ink[3] * opacity], background);
    const ratio = contrast(painted, background);
    const size = parseFloat(style.fontSize) || 16;
    const bold = Number(style.fontWeight) >= 700;
    const required = isIcon || size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < required) {
      report({ kind: isIcon ? "icon" : "text", ratio, required, disabled, element, label: isIcon ? iconName(element) : labelOf(element) }, painted, background);
    }
  }
  return findings.sort((a, b) => Number(a.disabled) - Number(b.disabled) || a.ratio - b.ratio);
}
