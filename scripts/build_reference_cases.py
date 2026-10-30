"""Renders the reference cases of the operating cost statement (Rechenbeispiele) into static pages.

The cases and mietkartei's result for them come from website/rechenbeispiele/faelle.json, which
app/src/lib/domain/reference-cases.spec.ts writes and keeps in step with the app. Each case page is
a sequence of steps: the house and who lived where, one step per bill, the result per tenant and
the independent check. Without JavaScript all steps show one below the other; with it,
assets/rechenbeispiele.js shows one at a time.

The CSP allows no inline styles, so bars are SVG rectangles with their size in attributes.
"""

import html
import json
from datetime import date
from pathlib import Path

from build_guides import fill, json_ld

SITE = "https://mietkartei.de"
DEMO = "https://demo.mietkartei.de"
KEY_LABELS = {
    "area": "nach Wohnfläche",
    "persons": "nach Personen",
    "units": "nach Wohneinheiten",
    "consumption": "nach Verbrauch",
    "mixed": "nach Heizkostenverordnung",
}
# A unit standing empty counts as this many persons, as "Personen bei Leerstand" in the app.
VACANCY_PERSONS = 1
METER_UNITS = {"heat": "kWh", "cold_water": "m³"}


def euro(cents: int) -> str:
    sign = "−" if cents < 0 else ""
    whole, rest = divmod(abs(cents), 100)
    return f"{sign}{whole:,}".replace(",", ".") + f",{rest:02d} €"


def number(value: float) -> str:
    if value == int(value):
        return f"{int(value):,}".replace(",", ".")
    return f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".").rstrip("0").rstrip(",")


def day(iso: str) -> str:
    return date.fromisoformat(iso).strftime("%d.%m.%Y")


def days(start: str, end: str) -> int:
    return (date.fromisoformat(end) - date.fromisoformat(start)).days + 1


def shift(iso: str, by: int) -> str:
    return date.fromordinal(date.fromisoformat(iso).toordinal() + by).isoformat()


def largest_remainder(total: int, weights: list[float]) -> list[int]:
    """Splits cents by weights, the leftover cents going to the largest remainders."""
    whole = sum(weights)
    exact = [total * weight / whole for weight in weights]
    parts = [int(value) for value in exact]
    order = sorted(range(len(weights)), key=lambda i: (-(exact[i] - parts[i]), i))
    for i in order[: total - sum(parts)]:
        parts[i] += 1
    return parts


def bar(segments: list[tuple[float, str]], height: int = 14) -> str:
    """A horizontal bar of (width, css class) segments, the widths in any unit."""
    total = sum(width for width, _ in segments) or 1
    x = 0.0
    rects = []
    for width, css in segments:
        share = 1000 * width / total
        rects.append(f'<rect class="{css}" x="{x:.2f}" y="0" width="{share:.2f}" height="{height}"/>')
        x += share
    return (
        f'<svg class="case-bar" viewBox="0 0 1000 {height}" preserveAspectRatio="none" '
        f'aria-hidden="true" focusable="false">{"".join(rects)}</svg>'
    )


class Case:
    def __init__(self, data: dict):
        self.data = data
        self.slug = data["slug"]
        self.year = data["year"]
        self.period = (f"{self.year}-01-01", f"{self.year}-12-31")
        self.units = data["units"]
        self.leases = data["leases"]
        self.items = data["items"]
        self.result = data["result"]
        self.lease_results = {lease["leaseId"]: lease for lease in self.result["leases"]}
        self.item_results = {item["itemId"]: item for item in self.result["items"]}
        # One colour per lease, in the order they appear in the house.
        ordered = [lease for unit in self.units for lease in self.leases_of(unit["id"])]
        self.colour = {lease["id"]: f"tone-{index % 6 + 1}" for index, lease in enumerate(ordered)}

    @property
    def path(self) -> str:
        return f"/rechenbeispiele/{self.slug}/"

    def leases_of(self, unit_id: str) -> list[dict]:
        return sorted((l for l in self.leases if l["unitId"] == unit_id), key=lambda l: l["start"])

    def timeline(self, unit_id: str, start: str | None = None, end: str | None = None) -> list[tuple[dict | None, str, str]]:
        """The unit's leases and the gaps between them (None) within start to end, in order."""
        start, end = start or self.period[0], end or self.period[1]
        parts, cursor = [], start
        for lease in self.leases_of(unit_id):
            first = max(lease["start"], start)
            last = min(lease["end"] or end, end)
            if first > last:
                continue
            if first > cursor:
                parts.append((None, cursor, shift(first, -1)))
            parts.append((lease, first, last))
            cursor = shift(last, 1)
        if cursor <= end:
            parts.append((None, cursor, end))
        return parts

    def segments(self, unit_id: str) -> list[tuple[int, str]]:
        return [
            (days(first, last), self.colour[lease["id"]] if lease else "tone-vacant")
            for lease, first, last in self.timeline(unit_id)
        ]

    def tenant(self, lease: dict) -> str:
        t = lease["tenant"]
        return f'{t["salutation"]} {t["lastName"]}'

    # The steps

    def house_step(self) -> str:
        rows = []
        for unit in reversed(self.units):
            names = []
            for lease, start, end in self.timeline(unit["id"]):
                if not lease:
                    names.append(
                        f'<li><span class="swatch tone-vacant"></span><b>Leerstand</b> {day(start)} bis {day(end)}'
                        f' · {days(start, end)} Tage, die der Vermieter trägt</li>'
                    )
                    continue
                persons = lease["persons"]
                names.append(
                    f'<li><span class="swatch {self.colour[lease["id"]]}"></span>'
                    f'<b>{html.escape(self.tenant(lease))}</b> {day(start)} bis {day(end)}'
                    f' · {persons} {"Person" if persons == 1 else "Personen"}'
                    f' · Vorauszahlung {euro(lease["operatingCostPrepayment"] + lease["heatingCostPrepayment"])} im Monat</li>'
                )
            rows.append(
                f'<div class="floor"><div class="floor-name"><b>{html.escape(unit["name"])}</b>'
                f'<span>{number(unit["area"])} m²</span></div>'
                f'<div class="floor-time">{bar(self.segments(unit["id"]), 24)}<ul>{"".join(names)}</ul></div></div>'
            )
        bills = "".join(
            f'<tr><td>{html.escape(item["description"])}</td><td>{day(item["periodStart"])} bis {day(item["periodEnd"])}</td>'
            f'<td>{KEY_LABELS[item["key"]]}</td><td class="num">{euro(item["amount"])}</td></tr>'
            for item in self.items
        )
        return f"""<h2>Das Haus und wer wann darin wohnte</h2>
            <p>{html.escape(self.data["property"]["street"])}, {html.escape(self.data["property"]["postalCode"])} {html.escape(self.data["property"]["city"])}. Jede Zeile ist eine Wohnung, der Balken das Jahr {self.year} vom 1. Januar bis 31. Dezember.</p>
            <div class="house">{"".join(rows)}</div>
            <h3>Die Belege</h3>
            <div class="table-wrap"><table class="case-table"><thead><tr><th>Beleg</th><th>Zeitraum</th><th>Verteilt</th><th class="num">Betrag</th></tr></thead><tbody>{bills}</tbody></table></div>"""

    def item_step(self, item: dict) -> str:
        summary = self.item_results[item["id"]]
        parts = [f'<h2>{html.escape(item["description"])}</h2>']
        parts.append(f'<p class="case-amount">{euro(item["amount"])} <span>{KEY_LABELS[item["key"]]}</span></p>')

        in_year = days(max(item["periodStart"], self.period[0]), min(item["periodEnd"], self.period[1]))
        item_days = days(item["periodStart"], item["periodEnd"])
        if in_year != item_days:
            parts.append(
                f'<h3>Was davon in das Jahr {self.year} gehört</h3>'
                f'<p>Die Rechnung gilt vom {day(item["periodStart"])} bis {day(item["periodEnd"])}, {item_days} Tage. '
                f'{in_year} davon liegen im Jahr {self.year}: {euro(item["amount"])} × {in_year}/{item_days} = <b>{euro(summary["total"])}</b>.</p>'
                + self.period_bar(item)
            )

        allocated = summary["allocated"]
        co2 = summary.get("co2")
        if co2:
            parts.append(self.co2_block(item, summary, co2))

        components = self.components(item, allocated)
        for label, weights, unit_label, amount in components:
            unit_amounts = largest_remainder(amount, weights)
            heading = f"{label}: {euro(amount)}" if label else f"Auf die Wohnungen: {euro(amount)}"
            rows = []
            for unit, weight, unit_amount in zip(self.units, weights, unit_amounts):
                rows.append(
                    f'<li><span class="row-label">{html.escape(unit["name"])}</span>'
                    f'<span class="row-key">{number(weight)} von {number(sum(weights))} {unit_label}</span>'
                    f'{bar([(unit_amount, "tone-unit"), (amount - unit_amount, "tone-rest")])}'
                    f'<span class="num">{euro(unit_amount)}</span></li>'
                )
            parts.append(f'<h3>{heading}</h3><ul class="split">{"".join(rows)}</ul>')
            leftover = amount - sum(int(amount * weight / sum(weights)) for weight in weights)
            if leftover:
                parts.append(
                    f'<p class="case-note">Auf ganze Cent abgerundet bleiben {leftover} Cent übrig. '
                    f'Sie gehen an die Anteile mit dem größten abgeschnittenen Rest, damit die Summe stimmt.</p>'
                )
        if len(components) > 1:
            rows = []
            for unit_index, unit in enumerate(self.units):
                total = sum(largest_remainder(amount, weights)[unit_index] for _, weights, _, amount in components)
                pieces = " + ".join(euro(largest_remainder(amount, weights)[unit_index]) for _, weights, _, amount in components)
                rows.append(
                    f'<li><span class="row-label">{html.escape(unit["name"])}</span><span class="row-key">{pieces}</span>'
                    f'{bar([(total, "tone-unit"), (allocated - total, "tone-rest")])}<span class="num">{euro(total)}</span></li>'
                )
            parts.append(f'<h3>Je Wohnung zusammen: {euro(allocated)}</h3><ul class="split">{"".join(rows)}</ul>')

        # Units with more than one lease or empty days: the unit's share split by days (or
        # person-days), the empty days' part borne by the landlord.
        item_start = max(item["periodStart"], self.period[0])
        item_end = min(item["periodEnd"], self.period[1])
        vacancy_total = 0
        for unit_index, unit in enumerate(self.units):
            shown = sum(largest_remainder(amount, weights)[unit_index] for _, weights, _, amount in components)
            charged = sum(self.line(l, item)["amount"] for l in self.leases_of(unit["id"]) if self.line(l, item))
            vacant = sum(days(first, last) for lease, first, last in self.timeline(unit["id"], item_start, item_end) if not lease)
            # The builder's split must give each unit what mietkartei gave its leases and its vacancy.
            if shown < charged or (shown != charged and not vacant):
                raise ValueError(f"{self.slug}/{item['id']}: {unit['id']} shows {shown}, mietkartei {charged}")
            vacancy_total += shown - charged
            leases = [l for l in self.leases_of(unit["id"]) if self.line(l, item)]
            if len(leases) + (1 if vacant else 0) < 2:
                continue
            rows = []
            for lease in leases:
                line = self.line(lease, item)
                detail = line["share"].split(" · ")[-1].removeprefix("davon ")
                rows.append(
                    f'<li><span class="row-label"><span class="swatch {self.colour[lease["id"]]}"></span>{html.escape(self.tenant(lease))}</span>'
                    f'<span class="row-key">{html.escape(detail)}</span>'
                    f'{bar([(line["amount"], self.colour[lease["id"]]), (shown - line["amount"], "tone-rest")])}'
                    f'<span class="num">{euro(line["amount"])}</span></li>'
                )
            if vacant:
                detail = (
                    f"{number(vacant * VACANCY_PERSONS)} Personentage, {VACANCY_PERSONS} je leerem Tag"
                    if item["key"] == "persons"
                    else f"{vacant} Tage leer"
                )
                rows.append(
                    f'<li><span class="row-label"><span class="swatch tone-vacant"></span>Leerstand, trägt der Vermieter</span>'
                    f'<span class="row-key">{detail}</span>'
                    f'{bar([(shown - charged, "tone-vacant"), (charged, "tone-rest")])}'
                    f'<span class="num">{euro(shown - charged)}</span></li>'
                )
            how = "nach Personentagen" if item["key"] == "persons" else "nach Tagen"
            parts.append(
                f'<h3>{html.escape(unit["name"])}: {euro(shown)} {how} geteilt</h3><ul class="split">{"".join(rows)}</ul>'
            )
        if vacancy_total != summary.get("vacancyShare", 0):
            raise ValueError(f"{self.slug}/{item['id']}: vacancy {vacancy_total}, mietkartei {summary.get('vacancyShare')}")
        return "\n".join(parts)

    def period_bar(self, item: dict) -> str:
        before = max(0, days(item["periodStart"], self.period[0]) - 1)
        inside = days(max(item["periodStart"], self.period[0]), min(item["periodEnd"], self.period[1]))
        after = max(0, days(self.period[1], item["periodEnd"]) - 1)
        return f'<div class="period">{bar([(before, "tone-rest"), (inside, "tone-unit"), (after, "tone-rest")])}<p><span>{day(item["periodStart"])}</span><span>{day(item["periodEnd"])}</span></p></div>'

    def co2_block(self, item: dict, summary: dict, co2: dict) -> str:
        kg = co2["kgPerSquareMetre"]
        tiers = [0, 12, 17, 22, 27, 32, 37, 42, 47, 52, 60]
        percents = [0, 10, 20, 30, 40, 50, 60, 70, 80, 95]
        cells = []
        for (low, high), percent in zip(zip(tiers, tiers[1:]), percents):
            current = low <= kg < high or (high == 60 and kg >= 52)
            cells.append(
                f'<li{" class=current" if current else ""}><span>{low}{"+" if high == 60 else f"–{high}"} kg</span><b>{percent} %</b></li>'
            )
        return (
            f'<h3>Zuerst der CO₂-Anteil des Vermieters</h3>'
            f'<p>Die Rechnung nennt {number(co2["co2Kg"])} kg CO₂ und {euro(co2["co2Cost"])} CO₂-Kosten. '
            f'Auf {number(co2["area"])} m² Wohnfläche sind das <b>{number(round(kg, 2))} kg je m²</b> im Jahr. '
            f'Nach dem Stufenmodell trägt der Vermieter in dieser Stufe {co2["landlordPercent"]} %, also <b>{euro(co2["landlordAmount"])}</b>. '
            f'Verteilt werden {euro(summary["total"])} − {euro(co2["landlordAmount"])} = <b>{euro(summary["allocated"])}</b>.</p>'
            f'<ol class="tiers" aria-label="Stufenmodell: Anteil des Vermieters je kg CO₂ pro m² und Jahr">{"".join(cells)}</ol>'
        )

    def components(self, item: dict, allocated: int) -> list[tuple[str, list[float], str, int]]:
        """(label, weight per unit, unit of the weights, amount) per part of the key."""
        area = [unit["area"] for unit in self.units]
        if item["key"] == "area":
            return [("", area, "m²", allocated)]
        if item["key"] == "units":
            return [("", [1] * len(self.units), "Wohnungen", allocated)]
        if item["key"] == "persons":
            weights = []
            for unit in self.units:
                weights.append(sum(
                    (lease["persons"] if lease else VACANCY_PERSONS) * days(first, last)
                    for lease, first, last in self.timeline(unit["id"])
                ))
            return [("", weights, "Personentagen", allocated)]
        meters = {meter["unitId"]: meter for meter in self.data.get("meters") or []}
        usage = [meters[unit["id"]]["end"] - meters[unit["id"]]["start"] for unit in self.units]
        meter_unit = METER_UNITS[meters[self.units[0]["id"]]["kind"]] if meters else ""
        if item["key"] == "consumption":
            return [("", usage, meter_unit, allocated)]
        if item["key"] == "mixed":
            percent = item["consumptionPercent"]
            by_use = int(allocated * percent / 100 + 0.5)
            return [
                (f"{percent} % nach Verbrauch", usage, meter_unit, by_use),
                (f"{100 - percent} % nach Wohnfläche", area, "m²", allocated - by_use),
            ]
        raise ValueError(f"{self.slug}: key {item['key']} has no picture yet")

    def line(self, lease: dict, item: dict) -> dict | None:
        lines = self.lease_results[lease["id"]]["lines"]
        return next((line for line in lines if line["itemId"] == item["id"]), None)

    def result_step(self) -> str:
        rows = []
        for unit in self.units:
            for lease in self.leases_of(unit["id"]):
                result = self.lease_results[lease["id"]]
                balance = result["balance"]
                label = "Nachzahlung" if balance > 0 else "Guthaben" if balance < 0 else "ausgeglichen"
                rows.append(
                    f'<tr><td><span class="swatch {self.colour[lease["id"]]}"></span>{html.escape(self.tenant(lease))}'
                    f'<small>{html.escape(unit["name"])}, {result["occupancy"]["days"]} Tage</small></td>'
                    f'<td class="num">{euro(result["costsTotal"])}</td><td class="num">{euro(result["prepaymentsTotal"])}</td>'
                    f'<td class="num balance {"due" if balance > 0 else "credit"}">{euro(abs(balance))}<small>{label}</small></td></tr>'
                )
        landlord = self.result["landlordCo2Share"]
        vacancy = self.result["vacancyShare"]
        own = " und ".join(
            text
            for amount, text in [
                (landlord, f"{euro(landlord)} CO₂-Kosten"),
                (vacancy, f"{euro(vacancy)} für die Tage, an denen Wohnungen leer standen"),
            ]
            if amount
        )
        footer = (
            f'<p>Dazu trägt der Vermieter {own} selbst. Zusammen ergibt das genau die Belege des Jahres: {euro(self.result["costsTotal"])}.</p>'
            if own
            else f'<p>Zusammen ergeben die Anteile genau die Belege des Jahres: {euro(self.result["costsTotal"])}.</p>'
        )
        return f"""<h2>Das Ergebnis je Mieter</h2>
            <p>Die Anteile aller Belege, abzüglich der geleisteten Vorauszahlungen.</p>
            <div class="table-wrap"><table class="case-table result"><thead><tr><th>Mieter</th><th class="num">Kosten</th><th class="num">Vorauszahlungen</th><th class="num">Ergebnis</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>
            {footer}"""

    def check_step(self) -> str:
        expected = self.data["expected"]["leases"]
        rows = []
        for unit in self.units:
            for lease in self.leases_of(unit["id"]):
                result = self.lease_results[lease["id"]]
                own = sum(expected[lease["id"]]["shares"].values())
                same = own == result["costsTotal"] and expected[lease["id"]]["prepayments"] == result["prepaymentsTotal"]
                if not same:
                    raise ValueError(f"{self.slug}/{lease['id']}: the check differs from mietkartei")
                rows.append(
                    f'<tr><td>{html.escape(self.tenant(lease))}</td><td class="num">{euro(result["costsTotal"])}</td>'
                    f'<td class="num">{euro(own)}</td><td class="ok">✓ auf den Cent</td></tr>'
                )
        checks = "".join(f"<li>{html.escape(text)}</li>" for text in self.data["check"])
        sources = "".join(
            f'<li><a href="{html.escape(source["url"])}">{html.escape(source["label"])}</a></li>'
            for source in self.data["sources"]
        )
        return f"""<h2>Unabhängig nachgerechnet</h2>
            <ul class="checks">{checks}</ul>
            <div class="table-wrap"><table class="case-table"><thead><tr><th>Mieter</th><th class="num">mietkartei</th><th class="num">Nachrechnung</th><th></th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>
            <p>Bei jeder Änderung an mietkartei läuft dieses Beispiel als automatischer Test. Weicht ein Cent ab, wird die Änderung nicht übernommen. Das Beispiel und die erwarteten Beträge stehen offen im <a href="https://github.com/OliverHennhoefer/mietkartei.de/blob/main/app/src/lib/domain/reference-cases.ts">Quellcode</a>.</p>
            <h3>Rechtsgrundlagen</h3>
            <ul class="sources">{sources}</ul>"""

    def steps(self) -> list[tuple[str, str]]:
        steps = [("Haus", self.house_step())]
        steps += [(item["label"], self.item_step(item)) for item in self.items]
        steps += [("Ergebnis", self.result_step()), ("Nachrechnung", self.check_step())]
        return steps


def render_case(layout: str, case: Case) -> str:
    steps = case.steps()
    nav = "".join(
        f'<li><a href="#schritt-{index}"><span>{index}</span>{html.escape(label)}</a></li>'
        for index, (label, _) in enumerate(steps, start=1)
    )
    sections = "\n".join(
        f'<section class="case-step" id="schritt-{index}" aria-label="Schritt {index} von {len(steps)}">{body}</section>'
        for index, (_, body) in enumerate(steps, start=1)
    )
    content = f"""        <a class="back-link" href="/rechenbeispiele/"><span aria-hidden="true">←</span> Alle Rechenbeispiele</a>
        <p class="eyebrow">Rechenbeispiel Betriebskosten {case.year}</p>
        <h1>{html.escape(case.data["title"])}</h1>
        <p class="lead case-lead">{html.escape(case.data["intro"])}</p>
        <aside class="case-demo" aria-label="In der Demo ausprobieren">
          <div>
            <p class="case-demo-title">Selbst ausprobieren</p>
            <p>Dasselbe Haus als eigener Bestand in mietkartei, mit dem Entwurf genau dieser Abrechnung. Ändere einen Beleg und sieh, wie sich die Anteile verschieben.</p>
          </div>
          <a class="button button-primary" href="{DEMO}/demo?beispiel={case.data["slug"]}">In der Demo öffnen<span aria-hidden="true">↗</span></a>
        </aside>
        <nav class="case-steps" aria-label="Schritte"><ol>{nav}</ol></nav>
        <div class="case-body">
{sections}
        </div>
        <p class="case-pager" hidden><button type="button" data-step="-1">← Zurück</button><button type="button" data-step="1">Weiter →</button></p>"""
    return fill(
        layout,
        title=html.escape(case.data["title"]),
        description=html.escape(case.data["summary"]),
        path=case.path,
        og_type="article",
        json_ld=json_ld({
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": case.data["title"],
            "description": case.data["summary"],
            "inLanguage": "de-DE",
            "url": SITE + case.path,
            "publisher": {"@id": f"{SITE}/#organization"},
        }),
        content=content,
    )


def render_index(layout: str, cases: list[Case]) -> str:
    cards = []
    for case in cases:
        floors = "".join(bar(case.segments(unit["id"]), 10) for unit in reversed(case.units))
        cards.append(
            f'<li><a href="{case.path}"><div class="case-thumb">{floors}</div>'
            f'<div><h2>{html.escape(case.data["title"])}</h2><p>{html.escape(case.data["summary"])}</p>'
            f'<p class="case-facts">{len(case.units)} Wohnungen · {len(case.leases)} Mietverträge · {len(case.items)} {"Beleg" if len(case.items) == 1 else "Belege"} · Jahr {case.year}</p></div></a></li>'
        )
    content = f"""        <a class="back-link" href="/"><span aria-hidden="true">←</span> Zur Startseite</a>
        <p class="eyebrow">Nachgerechnet</p>
        <h1>Rechenbeispiele</h1>
        <p class="lead case-lead">Wie mietkartei Betriebskosten verteilt, Schritt für Schritt an kleinen Häusern mit erfundenen Mietern. Jedes Beispiel ist unabhängig nachgerechnet und läuft bei jeder Änderung als Test: Stimmt ein Cent nicht, wird die Änderung nicht übernommen.</p>
        <ul class="case-list">
          {"".join(cards)}
        </ul>"""
    return fill(
        layout,
        title="Rechenbeispiele",
        description="Betriebskostenabrechnung Schritt für Schritt: Mieterwechsel, Leerstand, Wasser nach Zählern, Heizkosten und CO₂-Aufteilung an Beispielen, unabhängig nachgerechnet.",
        path="/rechenbeispiele/",
        og_type="website",
        json_ld=json_ld({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": "Rechenbeispiele",
            "url": f"{SITE}/rechenbeispiele/",
            "inLanguage": "de-DE",
            "hasPart": [{"@type": "Article", "headline": c.data["title"], "url": SITE + c.path} for c in cases],
        }),
        content=content,
    )


def build_reference_cases(website: Path, output: Path) -> None:
    """Writes the overview and one page per case and adds them to the sitemap."""
    folder = website / "rechenbeispiele"
    layout = (folder / "_layout.html").read_text(encoding="utf-8")
    cases = [Case(data) for data in json.loads((folder / "faelle.json").read_text(encoding="utf-8"))]
    pages = {"rechenbeispiele/index.html": render_index(layout, cases)}
    for case in cases:
        pages[f"rechenbeispiele/{case.slug}/index.html"] = render_case(layout, case)
    for name, text in pages.items():
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(text, encoding="utf-8")

    sitemap = output / "sitemap.xml"
    entries = "".join(
        f"  <url>\n    <loc>{SITE}{path}</loc>\n  </url>\n"
        for path in ["/rechenbeispiele/", *(case.path for case in cases)]
    )
    sitemap.write_text(sitemap.read_text(encoding="utf-8").replace("</urlset>", entries + "</urlset>"), encoding="utf-8")
