Heap :: struct ($T: Type, compare: (a: T, b: T) -> bool) 
{
    tree : [..] T;
}
heap_peek :: (heap: *Heap($T, #type (heap.T, heap.T) -> (bool))) -> (T, success: bool)
{
    val: T;
    return val, false;
};