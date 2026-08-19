# Landing Hero — AI Image Regeneration Pack

Direction **B**: your 15 WhatsApp photos are the source of truth; these prompts turn the
three best into premium, consistent hero visuals. The carousel is already wired to
`/landing/photos/hero-*.jpg` — regenerate, save over those files, refresh. No code changes needed.

---

## Workflow (10 minutes)

1. **Upscale everything first** — run each chosen photo through **Upscayl** (free, local, no watermark)
   at 4× with the "Ultra Sharp" model. This keeps the real pixels when the Ken Burns zoom is active.
2. **Regenerate the hero frames** — paste the prompts below into **Bing Image Creator**, **Google Gemini**
   (Imagen), or **Ideogram**. Where a prompt says *"use this photo as reference"*, upload your upscaled
   photo so the AI matches your real stock/branch and people.
3. **Save over the file names listed** — same names, same folder: `public/landing/photos/`.
4. **Optional polish** — remove.bg a product cutout if a slide ever needs a floating item card.

**Style anchor (paste into every prompt):** *"Premium editorial food photography, soft directional
light, shallow depth of field, warm earthy tones with deep green and amber-gold accents, subtle film
grain, Nigerian grocery co-op setting, photorealistic, high detail, 16:9."*

---

## Slide 1 — Logistics / "Posted → Delivered" → `hero-logistics.jpg`

> Replace the background of [upload: warehouse-dock photo] with a clean, bright warehouse interior:
> workers in green polo shirts carefully unloading woven jute sacks of rice onto wooden pallets.
> Strong backlight through the loading bay, dust motes in the light, shallow depth of field on the
> foreground sacks. Nigerian food-distribution co-op, premium editorial style, warm tones with green
> accents, film grain, photorealistic, 16:9.

Fallback (no reference upload):
> A bright loading bay at golden hour. Two workers in green polos carry a woven jute sack of rice.
> Wooden pallets stacked with sacks in the foreground, soft light and haze, cinematic shallow depth
> of field. Nigerian grocery co-op distribution, premium editorial, warm green tones, film grain,
> photorealistic, 16:9.

---

## Slide 2 — Ram Season → `hero-ram.jpg`

> Use [upload: ram-field photo] as reference. Regrade: golden-hour light, the big ram in sharp focus
> with deep amber rim light on its curled horns, a soft haze behind the flock in the field, richer
> gold and warm brown tones, slight vignette. Premium livestock editorial photography, film grain,
> photorealistic, 16:9.

Fallback:
> A majestic ram with large curled horns standing in tall golden grass at sunset, amber rim light on
> its fleece, soft haze and warm glow behind, premium livestock editorial photography, shallow depth
> of field, film grain, photorealistic, 16:9.

---

## Slide 3 — Community / "More than groceries" → `hero-community.jpg`

> Use [upload: exhibition-booth photo] as reference. Clean the background: same members and co-op
> booth, but a tidier, brighter venue, banners in co-op green and gold, people smiling naturally,
> no clutter. Premium event photography, editorial grade, warm tones with green and gold accents,
> film grain, photorealistic, 16:9.

Fallback:
> Members of a Nigerian food co-op gathered around a neat booth at a community exhibition, talking
> and smiling, produce baskets and sacks on the table, co-op green and gold branding, bright airy
> venue, premium editorial event photography, film grain, photorealistic, 16:9.

---

## Quality bar (accept/reject)

- **Accept:** subject keeps real character; no extra fingers, warped text, or doubled faces; grain is
  subtle; the grade reads warm-with-green (matches the Sakani brand), not flat or oversaturated.
- **Reject and re-roll** anything with mangled booth signage text, unnatural skin, or the 16:9 frame
  cut off mid-subject. Regenerate until the *story* survives — these stay **real**, not airbrushed.

## Notes

- The carousel applies its own duotone/gradient overlay in CSS, so the source should be **neutral and
  well-lit** — don't bake heavy filters into the regenerated file.
- Keep the file names exactly: `hero-logistics.jpg`, `hero-ram.jpg`, `hero-community.jpg`.
- Upscayl is offline and free (github.com/upscayl/upscayl); Bing Image Creator and Gemini are free
  with a Microsoft/Google account.
