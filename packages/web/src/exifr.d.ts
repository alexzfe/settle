// exifr's lite build has no types of its own; it is the full build's API with fewer formats.
declare module "exifr/dist/lite.esm.mjs" {
  import exifr from "exifr";
  export default exifr;
}
