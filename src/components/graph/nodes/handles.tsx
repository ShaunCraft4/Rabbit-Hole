import { Handle, Position } from "@xyflow/react";

const handleClass = "!size-1.5 !border-0 !bg-paper/45";

export function NodeHandles() {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} className={handleClass} />
      <Handle type="source" position={Position.Right} isConnectable={false} className={handleClass} />
    </>
  );
}
