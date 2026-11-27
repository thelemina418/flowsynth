---
status: accepted
---
# Resonance replaces chords and pitch

Cells no longer have pitch. The octave-stack lattice, chords, harmonic capacity, formation quality and the chord allocation optimiser are removed. Each oscillator type instead has one resonance pattern: a shape of partner modules around it. One module can be a partner in any number of patterns, which makes layout a packing puzzle. We chose this because chords were the largest source of churn in the project, and because new players had to learn the lattice before they could make their first meaningful choice. Sound survives as theme and as the identity of the waveforms, not as a second hidden system. This supersedes the chord and lattice ADRs (including 0021, 0036, 0049, 0051, 0052, 0062 and 0064).
