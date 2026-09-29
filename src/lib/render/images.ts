/**
 * Presentation helpers for images and their attribution.
 *
 * The licence label table lives here rather than in a component so the
 * single-image popover and the gallery lightbox cannot end up describing the
 * same licence differently — the sort of drift nobody notices until a
 * photographer does.
 */
import { imageSrc } from '../content/href.ts';
import { ATTRIBUTION_REQUIRED, type ImageRef } from '../../schemas/primitives.ts';

export const LICENSE_LABELS: Record<string, string> = {
  cc0: 'CC0 1.0, public domain dedication',
  'public-domain': 'Public domain',
  'cc-by': 'CC BY',
  'cc-by-sa': 'CC BY-SA',
  'cc-by-nc': 'CC BY-NC',
  'cc-by-nd': 'CC BY-ND',
  gfdl: 'GFDL',
  'manufacturer-press-grant': 'Manufacturer press grant',
  'fair-use-editorial': 'Editorial fair use',
  'trademark-nominative-use': 'Trademark, nominative use',
};

export function licenseLabel(image: ImageRef): string {
  const { credit } = image;
  const base = LICENSE_LABELS[credit.licenseType] ?? credit.licenseType;
  return credit.licenseVersion ? `${base} ${credit.licenseVersion}` : base;
}

/** Serializable shape handed to the `Gallery` island as a prop. */
export interface GalleryImage {
  src: string;
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
  author?: string;
  licenseLabel: string;
  licenseUrl?: string;
  sourceUrl: string;
  licenseNote?: string;
  /** Drives the emphasis the lightbox gives the author's name. */
  attributionRequired: boolean;
}

/**
 * Flattens `ImageRef`s into props an island can receive.
 *
 * Islands are serialized across the server/client boundary, so this deliberately
 * hands over plain data rather than the schema type — and resolves `src`
 * through `imageSrc()` here, because the island has no access to the base path.
 */
export function toGalleryImages(images: ImageRef[]): GalleryImage[] {
  return images.map((image) => ({
    src: imageSrc(image.src),
    alt: image.alt,
    caption: image.caption,
    width: image.width,
    height: image.height,
    author: image.credit.author,
    licenseLabel: licenseLabel(image),
    licenseUrl: image.credit.licenseUrl,
    sourceUrl: image.credit.sourceUrl,
    licenseNote: image.credit.licenseNote,
    attributionRequired: ATTRIBUTION_REQUIRED.has(image.credit.licenseType),
  }));
}
