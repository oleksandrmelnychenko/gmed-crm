import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { Button } from "../../../src/components/ui/button";
import { Input } from "../../../src/components/ui/input";
import { NativeComboboxSelect } from "../../../src/components/ui/combobox-select";
import { SelectField } from "../../../src/components/ui/select-field";
import { Dialog, DialogContent, DialogTitle } from "../../../src/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "../../../src/components/ui/sheet";
import { useSheetDismissalGuard } from "../../../src/components/ui/sheet";
import { useOpenedFormDirty } from "../../../src/hooks/use-opened-form-dirty";
import "../../../src/index.css";

function Cancel({ onClose }: { onClose: () => void }) {
  const close = useSheetDismissalGuard(onClose);
  return <Button type="button" onClick={close}>Cancel editor</Button>;
}

function Harness() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Original");
  const [notes, setNotes] = useState("Initial notes");
  const [checked, setChecked] = useState(true);
  const [choice, setChoice] = useState("a");
  const [status, setStatus] = useState("a");
  const [radio, setRadio] = useState("a");
  const [date, setDate] = useState("2026-09-05");
  const [saved, setSaved] = useState(0);
  const [failSave, setFailSave] = useState(false);
  const [error, setError] = useState("");
  const [childOpen, setChildOpen] = useState(false);
  const [childName, setChildName] = useState("");
  const [rows, setRows] = useState(["First", "Second"]);
  const fullDraftDirty = useOpenedFormDirty(open, { name, notes, checked, choice, status, radio, date, rows });
  const controlled = new URLSearchParams(location.search).get("controlled") === "true";
  const sheet = new URLSearchParams(location.search).get("kind") === "sheet";
  const Root = sheet ? Sheet : Dialog;
  const Content = sheet ? SheetContent : DialogContent;
  const Title = sheet ? SheetTitle : DialogTitle;
  return <>
    <Button onClick={() => { setOpen(true); setError(""); }}>Open editor</Button>
    <output aria-label="Save count">{saved}</output>
    <Root open={open} onOpenChange={setOpen} requireChanges dirty={controlled ? fullDraftDirty : undefined}>
      <Content className="p-6 sm:max-w-xl" aria-describedby={undefined}>
        <Title>Edit values</Title>
        <form className="grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          if (failSave) { setError("Save failed"); return; }
          setSaved((value) => value + 1);
          setOpen(false);
        }}>
          <Input aria-label="Name" value={name} onChange={(event) => setName(event.target.value)} />
          <output aria-label="Draft name">{name}</output>
          <textarea aria-label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          <label><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />Enabled</label>
          <label><input type="radio" name="radio" checked={radio === "a"} onChange={() => setRadio("a")} />Radio A</label>
          <label><input type="radio" name="radio" checked={radio === "b"} onChange={() => setRadio("b")} />Radio B</label>
          <NativeComboboxSelect aria-label="Choice" value={choice} onChange={(event) => setChoice(event.target.value)} searchPlaceholder="Search choices"><option value="a">Alpha</option><option value="b">Beta</option></NativeComboboxSelect>
          <SelectField aria-label="Status" value={status} onValueChange={setStatus} options={[{ value: "a", label: "First" }, { value: "b", label: "Second" }]} />
          <Input aria-label="Date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <Button type="button" onClick={() => setFailSave(true)}>Simulate save failure</Button>
          <Button type="button" onClick={() => { setName("Original"); setNotes("Initial notes"); }}>Reset text fields</Button>
          <Button type="button" onClick={() => setRows((current) => [...current].reverse())}>Reverse rows</Button>
          <Button type="button" onClick={() => setChildOpen(true)}>Open child</Button>
          <Dialog open={childOpen} onOpenChange={setChildOpen} dirty={Boolean(childName)}>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Child editor</DialogTitle>
              <form onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); setChildName(""); setChildOpen(false); }}>
                <Input aria-label="Child name" value={childName} onChange={(event) => setChildName(event.target.value)} />
                <Button type="submit">Save child</Button>
              </form>
            </DialogContent>
          </Dialog>
          {error && <p role="alert">{error}</p>}
          <Cancel onClose={() => setOpen(false)} />
          <Button type="submit">Save values</Button>
        </form>
      </Content>
    </Root>
  </>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><LocalizationProvider dateAdapter={AdapterDayjs}><Harness /></LocalizationProvider></StrictMode>);
