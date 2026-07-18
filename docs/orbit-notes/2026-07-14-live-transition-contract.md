# Orbit Note - Live Transition Contract

Date: 2026-07-14
Decision: Keep the kernel and open the two-costume comparison.

Q1-A passed with a launcher-neutral action payload and a separate generic engine
observation payload. The state machine can therefore represent both clip
activation and pattern mutation without adding either concept to `Song`.

The useful constraint is that scheduled work cannot be replaced optimistically.
Before engine acknowledgement, a new gesture may cancel and replace the pending
transition. After acknowledgement, cancellation needs its own future engine
protocol. The spike will not hide that distinction.

Q1-B starts now. Q1-C is ready and must receive the same material, voices, and
interaction care before Q1-D records a preference.
