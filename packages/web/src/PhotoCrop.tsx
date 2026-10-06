// The crop box over a Photo about to be added: a free box dragged to any shape, with no fixed
// ratio and no rotate, since a Photo is already upright and the point is cutting away clutter.
// Loaded only when Crop is tapped, so the library stays out of the main bundle.

import { useState } from "react";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import styles from "./App.module.css";
import sheet from "./ItemPage.module.css";

const whole: PercentCrop = { unit: "%", x: 0, y: 0, width: 100, height: 100 };

/**
 * The picture under a crop box, starting from the last crop or the whole picture. Done hands back
 * the box in percent of the picture as shown, which is upright; Cancel hands back nothing.
 */
export default function PhotoCrop({
  src,
  initial,
  onDone,
  onCancel,
}: {
  src: string;
  initial?: PercentCrop;
  onDone: (crop: PercentCrop) => void;
  onCancel: () => void;
}) {
  const [crop, setCrop] = useState<PercentCrop>(initial ?? whole);
  return (
    <section className={sheet.crop} aria-label="Crop the photo">
      {/* Kept: a tap outside the box leaves it, rather than starting a new one from nothing. */}
      <ReactCrop
        crop={crop}
        onChange={(_, percent) => setCrop(percent)}
        keepSelection
        minWidth={24}
        minHeight={24}
      >
        <img className={sheet.cropImage} src={src} alt="To crop" />
      </ReactCrop>
      <div className={styles.actions}>
        <button type="button" onClick={() => onDone(crop)}>
          Done
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
