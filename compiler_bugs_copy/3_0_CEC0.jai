#add_context test := 5;
main :: ()
{
    #if #exists(context.test) {
        // do smth
    }
}