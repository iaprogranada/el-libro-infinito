import { longDate, SITE } from "@/lib/site";

export default function Footer() {
  return (
    <footer className="foot">
      <span>
        {SITE.name} es una idea original de{" "}
        <span className="nowrap">
          <b>{SITE.author}</b> – {SITE.agency}
        </span>
      </span>
      <span className="sep" aria-hidden="true">
        ·
      </span>
      <a href={SITE.agencyUrl} target="_blank" rel="noopener">
        {SITE.agencyLabel}
      </a>
      {SITE.launchDate && (
        <>
          <span className="sep" aria-hidden="true">
            ·
          </span>
          <span>
            Fecha de lanzamiento: <time dateTime={SITE.launchDate}>{longDate(SITE.launchDate)}</time>
          </span>
        </>
      )}
    </footer>
  );
}
