// Profile photos are tiny (32x32) images sent as data URLs and drawn on the front of the head.
export const AVATAR_MAX_CHARS = 6000;

/** Only small PNG / JPEG / WebP data URLs with a plain base64 body are accepted. */
export function validAvatar(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length <= AVATAR_MAX_CHARS &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v)
  );
}
