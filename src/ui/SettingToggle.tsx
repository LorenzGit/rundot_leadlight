/** Shared settings toggle row, used by the Settings screen and the in-run
    settings card. */
export default function SettingToggle({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange(value: boolean): void;
}) {
    return (
        <label className="setting-row">
            <span>{label}</span>
            <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        </label>
    );
}
