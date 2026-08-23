#!/usr/bin/env node
// Generates src/design-system-safelist.txt -- the declared utility vocabulary
// for the distributable design-system stylesheet. See the header it emits.
import { writeFileSync } from "node:fs"

const out = []
const add = (...c) => out.push(...c.flat())
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

const spaceSteps = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64, 72, 80, 96]
const colors = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border", "input", "ring"]
const radii = ["none", "sm", "md", "lg", "xl", "2xl", "3xl", "full"]
const textSizes = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"]
const weights = ["thin", "light", "normal", "medium", "semibold", "bold", "extrabold"]

// layout
add("block", "inline-block", "inline", "flex", "inline-flex", "grid", "inline-grid", "hidden", "contents")
add("flex-row", "flex-row-reverse", "flex-col", "flex-col-reverse", "flex-wrap", "flex-nowrap", "flex-1", "flex-auto", "flex-initial", "flex-none", "grow", "grow-0", "shrink", "shrink-0")
add("items-start", "items-end", "items-center", "items-baseline", "items-stretch")
add("justify-start", "justify-end", "justify-center", "justify-between", "justify-around", "justify-evenly")
add("content-start", "content-center", "content-between", "self-start", "self-center", "self-end", "self-stretch")
add(range(1, 12).map((n) => `grid-cols-${n}`), range(1, 6).map((n) => `grid-rows-${n}`))
add(range(1, 12).map((n) => `col-span-${n}`), range(1, 6).map((n) => `row-span-${n}`), "col-span-full")
add("static", "relative", "absolute", "fixed", "sticky", "inset-0", "inset-x-0", "inset-y-0", "top-0", "right-0", "bottom-0", "left-0")
add("z-0", "z-10", "z-20", "z-30", "z-40", "z-50", "isolate")
add("overflow-auto", "overflow-hidden", "overflow-visible", "overflow-scroll", "overflow-x-auto", "overflow-y-auto", "truncate", "text-ellipsis", "whitespace-nowrap", "break-words", "min-w-0", "min-h-0")

// spacing
for (const s of spaceSteps) {
  add(`p-${s}`, `px-${s}`, `py-${s}`, `pt-${s}`, `pr-${s}`, `pb-${s}`, `pl-${s}`)
  add(`m-${s}`, `mx-${s}`, `my-${s}`, `mt-${s}`, `mr-${s}`, `mb-${s}`, `ml-${s}`)
  add(`gap-${s}`, `gap-x-${s}`, `gap-y-${s}`, `space-x-${s}`, `space-y-${s}`)
}
add("mx-auto", "ml-auto", "mr-auto", "mt-auto", "mb-auto")

// sizing
for (const s of spaceSteps) add(`w-${s}`, `h-${s}`, `size-${s}`)
add("w-full", "w-screen", "w-fit", "w-auto", "w-min", "w-max", "h-full", "h-screen", "h-fit", "h-auto", "size-full")
add("max-w-xs", "max-w-sm", "max-w-md", "max-w-lg", "max-w-xl", "max-w-2xl", "max-w-3xl", "max-w-4xl", "max-w-5xl", "max-w-6xl", "max-w-7xl", "max-w-full", "max-w-none", "max-w-prose")
add("min-h-screen", "min-h-full", "max-h-screen", "max-h-full")
add(["1/2", "1/3", "2/3", "1/4", "3/4", "1/5", "2/5", "3/5", "4/5"].map((f) => `w-${f}`))

// typography
add(textSizes.map((s) => `text-${s}`), weights.map((w) => `font-${w}`))
add("text-left", "text-center", "text-right", "text-justify", "uppercase", "lowercase", "capitalize", "normal-case")
add("leading-none", "leading-tight", "leading-snug", "leading-normal", "leading-relaxed", "leading-loose")
add("tracking-tighter", "tracking-tight", "tracking-normal", "tracking-wide", "tracking-wider")
add("underline", "no-underline", "line-through", "italic", "not-italic", "antialiased", "tabular-nums", "font-mono", "font-sans")
add("line-clamp-1", "line-clamp-2", "line-clamp-3", "line-clamp-none")

// color -- semantic tokens only
add(colors.map((c) => `bg-${c}`), colors.map((c) => `text-${c}`), colors.map((c) => `border-${c}`), colors.map((c) => `ring-${c}`), colors.map((c) => `fill-${c}`), colors.map((c) => `stroke-${c}`))
add("bg-transparent", "bg-current", "text-transparent", "text-current", "border-transparent")
add(["0", "5", "10", "20", "25", "30", "40", "50", "60", "70", "75", "80", "90", "95", "100"].map((o) => `opacity-${o}`))
add("bg-primary/10", "bg-primary/20", "bg-destructive/10", "bg-muted/50", "bg-background/80", "border-border/50")

// borders + effects
add("border", "border-0", "border-2", "border-4", "border-t", "border-r", "border-b", "border-l", "border-x", "border-y", "border-solid", "border-dashed", "divide-y", "divide-x")
add(radii.map((r) => (r === "none" ? "rounded-none" : `rounded-${r}`)), "rounded")
add("rounded-t-lg", "rounded-b-lg", "rounded-l-lg", "rounded-r-lg")
add("shadow-none", "shadow-xs", "shadow-sm", "shadow", "shadow-md", "shadow-lg", "shadow-xl", "shadow-2xl", "shadow-inner")
add("ring", "ring-0", "ring-1", "ring-2", "ring-offset-1", "ring-offset-2", "outline-none", "ring-offset-background")
add("cursor-pointer", "cursor-default", "cursor-not-allowed", "select-none", "pointer-events-none", "pointer-events-auto", "appearance-none")
add("transition", "transition-all", "transition-colors", "transition-opacity", "transition-transform", "duration-100", "duration-150", "duration-200", "duration-300", "duration-500", "ease-in", "ease-out", "ease-in-out", "animate-none", "animate-spin", "animate-pulse")
add("object-cover", "object-contain", "object-center", "aspect-square", "aspect-video", "backdrop-blur", "backdrop-blur-sm", "blur-sm", "sr-only", "not-sr-only")

const base = [...new Set(out)]

const variants = {
  "hover:": ["bg", "text", "border", "opacity", "shadow", "underline", "ring"],
  "focus-visible:": ["ring", "outline", "border", "bg"],
  "focus:": ["ring", "outline", "border"],
  "active:": ["bg", "text", "scale"],
  "disabled:": ["opacity", "cursor", "pointer-events", "bg", "text"],
  "dark:": ["bg", "text", "border", "ring", "shadow"],
}
const variantOut = []
for (const [v, prefixes] of Object.entries(variants))
  for (const c of base)
    if (prefixes.some((p) => c === p || c.startsWith(p + "-") || c.startsWith(p + "/"))) variantOut.push(v + c)

const bpTargets = base.filter((c) =>
  /^(flex|grid-cols|grid-rows|col-span|row-span|hidden|block|items|justify|gap|p|px|py|m|mx|my|mt|mb|w|h|max-w|text|space)-|^(hidden|block|flex|grid)$/.test(c),
)
const bpOut = []
for (const bp of ["sm:", "md:", "lg:", "xl:", "2xl:"]) for (const c of bpTargets) bpOut.push(bp + c)

const header = [
  "# Tailwind safelist for the distributable design-system stylesheet.",
  "#",
  "# Tailwind only generates utilities it finds in scanned source. Consumers of",
  "# this design system write markup that does not exist in this repo, so the",
  "# vocabulary they are entitled to use has to be declared up front. Every class",
  "# listed here is guaranteed present in dist-lib/styles.css.",
  "#",
  "# Colors are the semantic token names from design-system-tokens.css only --",
  "# no raw palette (bg-blue-500 etc.), because consumers should style against",
  "# tokens so light and dark themes both work.",
  "#",
  "# Regenerate with: node scripts/gen-safelist.mjs",
  "",
  "",
].join("\n")

const all = [...base, ...variantOut, ...bpOut]
writeFileSync(new URL("../src/design-system-safelist.txt", import.meta.url), header + all.join("\n") + "\n")
console.log(`safelist: ${base.length} base + ${variantOut.length} variant + ${bpOut.length} responsive = ${all.length}`)
