import { createBehaviourTree } from '@/bt';

async function main() {
  const tree = createBehaviourTree();

  tree.step();
}

main();
