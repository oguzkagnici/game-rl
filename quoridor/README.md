# Quoridor (not trained)

The project started with Quoridor and switched to Dara before any training was run. What is here is the
rules engine with batched tree search (`quoridor/engine.cpp`), its Python wrapper, a network, a training
loop and rules tests. There are no trained weights and no results.

```bash
python tests/test_engine.py
python train.py --hours 3
```
