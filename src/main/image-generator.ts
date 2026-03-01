/**
 * Image Generator — Gemini API + sharp
 *
 * Replaces the Python-based pipeline with native Node.js:
 * - Gemini API direct calls (no subprocess)
 * - sharp for resize/crop (no Python PIL dependency)
 * - Base64 direct transfer to Figma (no HTTP server)
 */

import sharp from 'sharp';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';

const GEMINI_API_KEY = 'AIzaSyDkXdVjlrTXDDIoHvO-VNp9fUul7UDfy4E';
const GEMINI_MODEL = 'gemini-3-pro-image-preview';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const DEFAULT_STYLE = 'Cinema4D, Octane render, studio lighting with soft rim light, front view, orthographic view, glossy plastic material, smooth highlights and shadows, simple symbolic forms, transparent background, clean minimal';

export interface ImageRequest {
  /** Prompt describing the image to generate */
  prompt: string;
  /** Target width in Figma (image will be 3x) */
  figmaWidth: number;
  /** Target height in Figma (image will be 3x) */
  figmaHeight: number;
  /** Custom style override (default: 3D Toss-style) */
  style?: string;
  /** Path to reference image for style consistency */
  referenceImagePath?: string;
  /** Whether to remove background */
  removeBackground?: boolean;
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

export class ImageGenerator {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  /** Generate an image using Gemini API, process with sharp, return base64 */
  async generate(request: ImageRequest): Promise<ImageResult> {
    const targetWidth = request.figmaWidth * 3;
    const targetHeight = request.figmaHeight * 3;
    const style = request.style || DEFAULT_STYLE;

    // Build prompt parts
    const parts: Array<Record<string, unknown>> = [];

    // Add reference image if provided
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

    // Add text prompt
    const fullPrompt = `${request.prompt}. Style: ${style}. Output size: ${targetWidth}x${targetHeight} pixels.`;
    parts.push({ text: fullPrompt });

    // Call Gemini API
    const response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': GEMINI_API_KEY,
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

    // Process with sharp: resize/crop to target dimensions
    let processed = sharp(rawBuffer);

    if (request.removeBackground) {
      // sharp can't do AI background removal, but we can trim transparent areas
      processed = processed.trim();
    }

    // Center-crop and resize to exact target dimensions
    processed = processed.resize(targetWidth, targetHeight, {
      fit: 'cover',
      position: 'centre',
    });

    const outputBuffer = await processed.png().toBuffer();
    const base64 = outputBuffer.toString('base64');

    // Save to disk
    await mkdir(this.outputDir, { recursive: true });
    const filePath = join(this.outputDir, `${request.outputName}.png`);
    await writeFile(filePath, outputBuffer);

    console.log(`[ImageGen] Saved: ${filePath} (${targetWidth}x${targetHeight})`);

    return {
      filePath,
      base64,
      width: targetWidth,
      height: targetHeight,
    };
  }

  /** Generate multiple images in parallel */
  async generateBatch(requests: ImageRequest[]): Promise<ImageResult[]> {
    return Promise.all(requests.map((r) => this.generate(r)));
  }
}
