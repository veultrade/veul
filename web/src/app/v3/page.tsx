import { permanentRedirect } from "next/navigation";

/** /v3 was the review URL for the new landing; it is the main landing at / now. */
export default function V3Page() {
  permanentRedirect("/");
}
