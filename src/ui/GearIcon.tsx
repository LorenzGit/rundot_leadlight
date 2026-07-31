/**
 * The settings gear, drawn for the size it is used at.
 *
 * The obvious cog — a 12-vertex outline of a toothed wheel — resolves on a
 * 40px tile and turns to mush at half that: the notches close up and it reads
 * as a blob. A silhouette survives the size where an outline cannot, so this is
 * a solid eight-tooth gear: one contour for the body (teeth at r=8.34, notches
 * at r=6.38) and one for the bore, knocked out by the even-odd fill.
 *
 * It has to be that single union outline, not two overlapping squares 45° apart
 * — the bore sits inside BOTH of those, so a nonzero fill leaves it solid and
 * the whole thing reads as a blob again.
 *
 * Both places that show a gear render this component. Two hand-tuned copies of
 * a sixteen-point path would drift the first time either is touched, and the
 * one that drifted would be the one nobody was looking at.
 */
export default function GearIcon() {
    return (
        <svg className="gear-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20.34 12 17.89 14.44 17.9 17.9 14.44 17.89 12 20.34 9.56 17.89 6.1 17.9 6.11 14.44 3.66 12 6.11 9.56 6.1 6.1 9.56 6.11 12 3.66 14.44 6.11 17.9 6.1 17.89 9.56ZM12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z" />
        </svg>
    );
}
