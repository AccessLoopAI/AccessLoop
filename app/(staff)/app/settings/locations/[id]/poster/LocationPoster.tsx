import { QrCode } from "@/components/ui/QrCode";
import type { OrgContact } from "@/components/layout/OrgContacts";
import { detectFrench } from "@/lib/intake/language";
import type { QrDrawing } from "@/lib/locations/qr";

/**
 * One location's poster (Phase 7 T4.5): the page that is printed and put up at the place. Light paper and dark ink in
 * every theme, so the screen shows what prints (`.al-poster` in app/globals.css: one Letter or A4 page in print). It
 * speaks to the public, so it uses the reporter's words (grade 6-8, the form's own questions), and it never asks for
 * a phone: the address is printed under the code, and the organization's phone and email are on it too (ACR s.9(3)).
 */
export function LocationPoster({
  org,
  name,
  detail,
  url,
  drawing,
}: {
  org: Pick<OrgContact, "name" | "feedbackDesignateTitle" | "contactPhone" | "contactEmail">;
  name: string;
  detail: string | null;
  /** The address the code opens (null: none configured, so no code is drawn). */
  url: string | null;
  drawing: QrDrawing | null;
}) {
  const askFor = org.feedbackDesignateTitle.replace(/^the\s+/i, "");
  return (
    <article className="al-poster" aria-labelledby="poster-title" data-testid="poster">
      <p className="al-poster-org">{org.name}</p>

      <div className="al-poster-intro">
        <h2 id="poster-title" className="al-poster-title">
          Did something here get in your way?
        </h2>
        <p className="al-poster-lead">
          Tell us about it, so we can fix it. When the fix is ready, you can tell us if it works for you.
        </p>
      </div>

      <p className="al-poster-place">
        <span className="al-poster-place-label">This poster is for</span>
        <span className="al-poster-place-name" lang={detectFrench(name)}>
          {name}
        </span>
        {detail ? (
          <span className="al-poster-place-detail" lang={detectFrench(detail)}>
            {detail}
          </span>
        ) : null}
      </p>

      <div className="al-poster-body">
        {drawing ? (
          <div className="al-poster-code">
            <QrCode drawing={drawing} label={`QR code: opens ${org.name}'s report form for ${name}`} />
          </div>
        ) : null}
        <ol className="al-poster-steps">
          <li>
            <span className="al-poster-step-n" aria-hidden="true">
              1
            </span>
            <span>Point your phone&rsquo;s camera at the code, and open the link.</span>
          </li>
          <li>
            <span className="al-poster-step-n" aria-hidden="true">
              2
            </span>
            <span>Tell us what got in your way. You can type or use your phone&rsquo;s dictation.</span>
          </li>
          <li>
            <span className="al-poster-step-n" aria-hidden="true">
              3
            </span>
            <span>You don&rsquo;t have to give your name. You get a code to check on your report.</span>
          </li>
        </ol>
      </div>

      {url ? (
        <p className="al-poster-url">
          <span className="al-poster-url-label">No camera? Type this address:</span>
          <span className="al-poster-url-text" data-testid="poster-url">
            {url}
          </span>
        </p>
      ) : null}

      <div className="al-poster-other">
        <p>
          You can also tell us by phone or email. Ask for the {askFor}.
        </p>
        <p className="al-poster-contacts">
          <span>
            <span className="font-bold">Phone </span>
            {org.contactPhone}
          </span>
          <span className="wrap-anywhere">
            <span className="font-bold">Email </span>
            {org.contactEmail}
          </span>
        </p>
      </div>
    </article>
  );
}
