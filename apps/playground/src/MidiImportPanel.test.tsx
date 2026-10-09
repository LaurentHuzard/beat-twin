import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MidiImportPanel } from "./MidiImportPanel";
import { usePlaygroundStore } from "./store";
import { fixtureMidi } from "./test/midiFixture";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); usePlaygroundStore.setState(usePlaygroundStore.getInitialState(),true); });
function file(bytes = fixtureMidi()) {
  const file = new File([bytes.buffer as ArrayBuffer],"seed.mid");
  Object.defineProperty(file,"arrayBuffer",{value: async () => bytes.buffer});
  return file;
}
it("preview and discard do not mutate the song or save; acceptance is explicit and focus returns", async () => {
  usePlaygroundStore.getState().createDemo();
  const before = usePlaygroundStore.getState().commandState;
  const save = vi.spyOn(localStorage,"setItem");
  render(<MidiImportPanel />);
  fireEvent.change(screen.getByLabelText("Local MIDI file"),{target:{files:[file()]}});
  await screen.findByRole("button",{name:"Add MIDI tracks"});
  expect(usePlaygroundStore.getState().commandState).toBe(before);
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText(/Current tempo stays at 124 BPM/)).toBeInTheDocument();
  const review = screen.getByText("Review notes in Seed · Ch 1").parentElement as HTMLDetailsElement;
  review.open = true;
  fireEvent(review, new Event("toggle"));
  expect(screen.getByRole("table",{name:"Notes in Seed · Ch 1"})).toHaveTextContent("6010001");
  fireEvent.click(screen.getByRole("button",{name:"Discard MIDI preview"}));
  expect(usePlaygroundStore.getState().commandState).toBe(before);
  expect(save).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByLabelText("Local MIDI file")).toHaveFocus());
  fireEvent.change(screen.getByLabelText("Local MIDI file"),{target:{files:[file()]}});
  await screen.findByRole("button",{name:"Add MIDI tracks"});
  fireEvent.click(screen.getByRole("button",{name:"Add MIDI tracks"}));
  expect(usePlaygroundStore.getState().commandState.revision).toBe(before.revision+1);
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent("MIDI tracks added");
});
it("stale preview disables acceptance; malformed files leave state intact", async () => {
  render(<MidiImportPanel />);
  fireEvent.change(screen.getByLabelText("Local MIDI file"),{target:{files:[file()]}});
  await screen.findByRole("button",{name:"Add MIDI tracks"});
  act(() => usePlaygroundStore.getState().createDemo());
  expect(screen.getByRole("button",{name:"Add MIDI tracks"})).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Song changed since preview");
  const before = usePlaygroundStore.getState().commandState;
  fireEvent.change(screen.getByLabelText("Local MIDI file"),{target:{files:[file(new Uint8Array(14))]}});
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid Standard MIDI header"));
  expect(usePlaygroundStore.getState().commandState).toBe(before);
});

it("deferred file reads preserve chooser focus without stealing focus the user moved elsewhere, including refusals", async () => {
  render(<><MidiImportPanel /><button type="button">Other control</button></>);
  const input=screen.getByLabelText("Local MIDI file") as HTMLInputElement;
  const other=screen.getByRole("button",{name:"Other control"});
  for(const leave of [false,true]) {
    let complete!:(bytes:ArrayBuffer)=>void;
    const pending=new Promise<ArrayBuffer>(resolve=>{complete=resolve;});
    const chosen=new File([fixtureMidi().buffer as ArrayBuffer],"same.mid");
    Object.defineProperty(chosen,"arrayBuffer",{value:()=>pending});
    input.focus();fireEvent.change(input,{target:{files:[chosen]}});
    expect(input).not.toBeDisabled();expect(input).toHaveFocus();
    if(leave)other.focus();
    await act(async()=>complete(fixtureMidi().buffer as ArrayBuffer));
    await screen.findByRole("button",{name:"Add MIDI tracks"});
    expect(screen.getByLabelText("Local MIDI file")).toBe(input);
    expect(leave?other:input).toHaveFocus();expect(input.value).toBe("");
  }
  input.focus();fireEvent.change(input,{target:{files:[file(new Uint8Array(14))]}});
  await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("Invalid Standard MIDI header"));
  expect(screen.getByLabelText("Local MIDI file")).toBe(input);expect(input).toHaveFocus();
  const huge=new File([new Uint8Array(1024*1024+1)],"oversize.mid");
  fireEvent.change(input,{target:{files:[huge]}});
  expect(screen.getByRole("alert")).toHaveTextContent("no larger than 1 MiB");expect(input).toHaveFocus();
  fireEvent.change(input,{target:{files:[file()]}});await screen.findByRole("button",{name:"Add MIDI tracks"});expect(input).toHaveFocus();
});

it("new file intent supersedes an unfinished read, including immediate oversize refusal", async () => {
  render(<MidiImportPanel />);
  let complete!:(bytes:ArrayBuffer)=>void;
  const pending=new Promise<ArrayBuffer>(resolve=>{complete=resolve;});
  const chosen=new File([fixtureMidi().buffer as ArrayBuffer],"pending.mid");
  Object.defineProperty(chosen,"arrayBuffer",{value:()=>pending});
  const input=screen.getByLabelText("Local MIDI file");
  fireEvent.change(input,{target:{files:[chosen]}});expect(screen.getByRole("status")).toHaveTextContent("Reading local MIDI");
  fireEvent.change(input,{target:{files:[new File([new Uint8Array(1024*1024+1)],"large.mid")]}});
  expect(screen.getByRole("alert")).toHaveTextContent("no larger than 1 MiB");expect(screen.queryByRole("status")).not.toBeInTheDocument();
  await act(async()=>complete(fixtureMidi().buffer as ArrayBuffer));
  expect(screen.queryByRole("button",{name:"Add MIDI tracks"})).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("no larger than 1 MiB");
});
