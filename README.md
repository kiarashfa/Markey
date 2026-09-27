# Markey

**Markey** (from *marque* + *key*) is a free, non-profit encyclopedia of production cars, with no ads, no accounts, and nothing to subscribe to.

A *marque* is the automotive world's word for a car's make: its brand name, its manufacturer, the badge on the bonnet. Swapping the end of it for *key* is a small joke that happens to be true twice over — the key you turn, and a key into the database.

Every figure on it is either sourced or computed, and it always says which. A specification carries the document it came from, cited down to the revision it was read at, and a number nobody has found yet is shown as a gap rather than quietly filled in with something plausible. That rule is enforced by the build rather than by good intentions: the schema refuses a placeholder that carries a number, and a citation pointing at nothing stops the build instead of shipping.

It also does the physics. Acceleration, top speed, drag, braking and energy use are modelled from each car's own published specifications and shown beside the manufacturer's claims, with the difference stated plainly — including where the model is weakest. The wind tunnel is a real lattice-Boltzmann solver running on your GPU, not a decorative particle effect: it is validated against a published drag correlation at the Reynolds number it actually runs, and it withdraws its own drag figure rather than report one from a solve that went unstable. You can also specify a car that never existed, run it through the identical functions, put its shape in the tunnel, and feed the measured drag back into its top speed.

Browse it by body style, powertrain, drivetrain, origin, segment, market position or decade — every one of those a view computed over tagged entries, so nothing breaks when a car is reclassified. Compare four cars side by side, narrow the catalog down to what you actually need, or work out what something costs to run at the price you actually pay.

What you save stays in your browser. A garage, a comparison or a car you built lives in your own storage or travels in a link you choose to share, because there is no server to send it to.

---

**Live site:** <https://kiarashfa.github.io/Markey/> · **Sibling encyclopedias:** [Xefy](https://kiarashfa.github.io/Xefy/) · [eXir](https://kiarashfa.github.io/eXir/) · **Markey** · [ARMAG](https://kiarashfa.github.io/ARMAG/)

© 2026 Kiarash Farajzadehahary.

⚖ Licensed under the [KFA Source-Available License 1.0](LICENSE).

Made with ❤️ and `½ · ρ · v² · Cd · A`
