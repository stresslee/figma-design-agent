/**
 * Image Generator — Gemini API + rembg + sharp
 *
 * Pipeline:
 * 1. Gemini API → generate image (base64 PNG)
 * 2. rembg (Python, u2net AI model) → remove background → transparent PNG
 * 3. sharp → trim transparent edges + resize
 * 4. Base64 direct transfer to Figma via set_image_fill
 */

import sharp from 'sharp';
import { writeFile, mkdir, readFile, readdir } from 'fs/promises';
import { join, dirname, extname } from 'path';
import { execFile } from 'child_process';

const GEMINI_MODEL = 'gemini-3-pro-image-preview';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const DEFAULT_STYLE = 'Cinema4D, Octane render, soft diffused studio lighting, front view, orthographic projection, matte clay-like material with subtle specular, NOT too glossy, warm gentle shadows, simple symbolic forms, rounded friendly shapes, Toss-style 3D icon aesthetic, transparent background, clean minimal, high detail, professional quality';

const TOSSFACE_2D_STYLE = 'Tossface emoji style: completely flat 2D, NO gradients, NO shadows, NO outlines, NO 3D effects, NO perspective, simple geometric rounded shapes, 2-3 solid bright colors only, minimal detail, like a simplified emoji icon, clean vector look, transparent background';

export interface ImageRequest {
  /** Prompt describing the image to generate */
  prompt: string;
  /** Target width in Figma (image will be 3x) */
  figmaWidth: number;
  /** Target height in Figma (image will be 3x) */
  figmaHeight: number;
  /** Custom style override (default: 3D Julee-style) */
  style?: string;
  /** Path to reference image for style consistency */
  referenceImagePath?: string;
  /** Whether to remove background */
  removeBackground?: boolean;
  /** Explicit hero/banner mode — keeps background, forces right-side positioning */
  isHero?: boolean;
  /** Output filename (without extension) */
  outputName: string;
}

export interface ImageResult {
  /** Path to saved image file */
  filePath: string;
  /** Base64-encoded PNG data for direct Figma upload */
  base64: string;
  /** Actual image width */
  width: number;
  /** Actual image height */
  height: number;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/** Prompt keywords → subfolder mapping */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  hero: ['banner', 'hero', '배너', '히어로', 'carousel', '카루셀', 'background', 'cover'],
  icon: ['icon', 'logo', '아이콘', '로고', 'symbol', 'badge', 'coin', 'gift', 'object'],
};

export class ImageGenerator {
  private outputDir: string;
  private apiKey: string;
  private referenceDir: string;

  constructor(outputDir: string, apiKey: string = '') {
    this.outputDir = outputDir;
    this.apiKey = apiKey;
    // Reference images folder: assets/reference-images/ (sibling to assets/generated/)
    this.referenceDir = join(dirname(outputDir), 'reference-images');
  }

  /** Update the API key at runtime */
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /** Generate an image using Gemini API, process with sharp, return base64 */
  async generate(request: ImageRequest): Promise<ImageResult> {
    if (!this.apiKey) {
      throw new Error('Gemini API key not configured. Set it in Settings.');
    }

    // Detect hero mode: explicit parameter takes priority, then keyword fallback
    const promptLower = request.prompt.toLowerCase();
    const isHero = request.isHero !== undefined
      ? request.isHero
      : CATEGORY_KEYWORDS.hero.some(kw => promptLower.includes(kw));
    console.log(`[ImageGen] Mode: ${isHero ? 'HERO' : 'ICON'} (explicit=${request.isHero !== undefined}), prompt: "${request.prompt.slice(0, 80)}..."`);

    const targetWidth = request.figmaWidth * 3;
    const targetHeight = request.figmaHeight * 3;
    const is2dStyle = request.style?.toLowerCase() === '2d' || request.style?.toLowerCase() === 'tossface';
    const style = is2dStyle ? TOSSFACE_2D_STYLE : (request.style || DEFAULT_STYLE);

    // Build prompt parts
    const parts: Array<Record<string, unknown>> = [];

    // Add reference image if explicitly provided
    if (request.referenceImagePath) {
      try {
        const refData = await readFile(request.referenceImagePath);
        parts.push({
          inlineData: {
            mimeType: 'image/png',
            data: refData.toString('base64')
          }
        });
      } catch {
        console.warn('[ImageGen] Could not load reference image:', request.referenceImagePath);
      }
    }

    // Auto-load reference images from assets/reference-images/
    const autoRefs = await this.findReferenceImages(request.prompt, is2dStyle ? '2d' : undefined);
    for (const ref of autoRefs) {
      try {
        const refData = await readFile(ref.path);
        const ext = extname(ref.path).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        parts.push({
          inlineData: { mimeType, data: refData.toString('base64') }
        });
        console.log(`[ImageGen] Reference image: ${ref.name} (${ref.category})`);
      } catch {
        console.warn(`[ImageGen] Failed to load reference: ${ref.path}`);
      }
    }

    // Build text prompt — hero keeps background + right-side layout, icon gets transparent
    const refNote = autoRefs.length > 0
      ? ` CRITICAL: You MUST match the visual style, material quality, lighting, color palette, and 3D rendering technique of the provided reference image(s) as closely as possible.`
      : '';

    let modeInstructions: string;
    if (isHero) {
      modeInstructions = [
        'IMPORTANT: Keep the background as part of the image (solid color or gradient, absolutely NOT transparent).',
        'IMPORTANT: All graphic elements/objects MUST be positioned on the RIGHT SIDE of the image. The LEFT 60% of the image must be completely empty (only background color/gradient visible) because text will be overlaid there.',
        'CRITICAL RULE: The image must contain NO MORE THAN 2-3 simple objects total. Do NOT add extra decorative elements, scattered items, or small floating objects. If the prompt mentions more than 3 objects, pick only the 2-3 most important ones and ignore the rest. Minimalism is key — fewer objects, larger scale, more empty space.',
      ].join(' ');
    } else {
      modeInstructions = 'IMPORTANT: transparent background (PNG with alpha channel, no solid background).';
    }

    const fullPrompt = `${request.prompt}. Style: ${style}.${refNote} ${modeInstructions} Output size: ${targetWidth}x${targetHeight} pixels. High quality, highly detailed rendering.`;
    parts.push({ text: fullPrompt });

    // Call Gemini API
    const response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { data: string; mimeType: string };
            text?: string;
          }>;
        };
      }>;
    };

    // Extract image from response
    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts) {
      throw new Error('No image in Gemini response');
    }

    const imagePart = candidate.content.parts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      throw new Error('No image data in Gemini response');
    }

    const rawBuffer = Buffer.from(imagePart.inlineData.data, 'base64');

    let outputBuffer: Buffer;
    let finalWidth: number;
    let finalHeight: number;

    if (isHero) {
      // Hero: keep background, just resize to exact target dimensions (cover fit)
      console.log('[ImageGen] Hero mode: keeping background, resizing to fill');
      outputBuffer = await sharp(rawBuffer)
        .resize(targetWidth, targetHeight, { fit: 'cover' })
        .png({ compressionLevel: 4 })
        .toBuffer();
      finalWidth = targetWidth;
      finalHeight = targetHeight;
    } else {
      // Icon: remove background + trim + resize
      console.log('[ImageGen] Icon mode: removing background with rembg...');
      const noBgBuffer = await this.removeBackground(rawBuffer);

      let processed = sharp(noBgBuffer).ensureAlpha();

      // Trim transparent edges
      try {
        processed = processed.trim({ threshold: 20 });
      } catch {
        console.warn('[ImageGen] Trim failed, using original');
      }

      // Resize to fit within target dimensions (preserve aspect ratio)
      processed = processed.resize(targetWidth, targetHeight, {
        fit: 'inside',
        withoutEnlargement: false,
      });

      outputBuffer = await processed.png({ compressionLevel: 4 }).toBuffer();
      const metadata = await sharp(outputBuffer).metadata();
      finalWidth = metadata.width || targetWidth;
      finalHeight = metadata.height || targetHeight;
    }

    const base64 = outputBuffer.toString('base64');

    // Save to disk
    await mkdir(this.outputDir, { recursive: true });
    const filePath = join(this.outputDir, `${request.outputName}.png`);
    await writeFile(filePath, outputBuffer);

    console.log(`[ImageGen] Saved: ${filePath} (${finalWidth}x${finalHeight}, trimmed+alpha)`);

    return {
      filePath,
      base64,
      width: finalWidth,
      height: finalHeight,
    };
  }

  /**
   * Find reference images from assets/reference-images/{hero,icon}/.
   * Matches prompt keywords to subfolder, picks up to 2 random images.
   */
  private async findReferenceImages(prompt: string, forceCategory?: string): Promise<Array<{ path: string; name: string; category: string }>> {
    const promptLower = prompt.toLowerCase();

    // Determine which category matches the prompt
    let matchedCategory = forceCategory || 'icon'; // default fallback
    if (!forceCategory) {
      for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (keywords.some(kw => promptLower.includes(kw))) {
          matchedCategory = category;
          break;
        }
      }
    }

    const categoryDir = join(this.referenceDir, matchedCategory);
    let files: string[];
    try {
      files = await readdir(categoryDir);
    } catch {
      return [];
    }

    const imageFiles = files.filter(f => IMAGE_EXTENSIONS.has(extname(f).toLowerCase()));
    if (imageFiles.length === 0) return [];

    // Fisher-Yates shuffle for unbiased randomness
    for (let i = imageFiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [imageFiles[i], imageFiles[j]] = [imageFiles[j], imageFiles[i]];
    }
    return imageFiles.slice(0, 2).map(f => ({
      path: join(categoryDir, f),
      name: f,
      category: matchedCategory,
    }));
  }

  /** Remove background using rembg (Python u2net AI model) via subprocess */
  private async removeBackground(inputBuffer: Buffer): Promise<Buffer> {
    // Save input to temp file
    const tmpDir = join(this.outputDir, '.tmp');
    await mkdir(tmpDir, { recursive: true });
    const tmpIn = join(tmpDir, `rembg_in_${Date.now()}.png`);
    const tmpOut = join(tmpDir, `rembg_out_${Date.now()}.png`);

    await writeFile(tmpIn, inputBuffer);

    return new Promise<Buffer>((resolve, reject) => {
      execFile('python3', [
        '-c',
        `from rembg import remove; from PIL import Image; import io
img = Image.open("${tmpIn}")
out = remove(img)
out.save("${tmpOut}", "PNG")
print("done")`,
      ], { timeout: 60000 }, async (error, stdout, stderr) => {
        try {
          if (error) {
            console.warn('[ImageGen] rembg failed, using original image:', error.message);
            resolve(inputBuffer);
            return;
          }
          console.log('[ImageGen] rembg complete');
          const result = await readFile(tmpOut);
          resolve(result);
        } catch (e) {
          console.warn('[ImageGen] rembg read failed:', e);
          resolve(inputBuffer);
        } finally {
          // Clean up temp files
          const { unlink } = require('fs/promises');
          unlink(tmpIn).catch(() => {});
          unlink(tmpOut).catch(() => {});
        }
      });
    });
  }

  /** Generate multiple images in parallel */
  async generateBatch(requests: ImageRequest[]): Promise<ImageResult[]> {
    return Promise.all(requests.map((r) => this.generate(r)));
  }
}
