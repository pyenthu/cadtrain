## TODO PLAN

Spawn separate sub process to do the following.
1. Plan a RAG based AI system with multi shots. Like we have in SVTC. The AI system should have context of the tab being used. Also i would like to have the option of running a web-llm and build the prompt databases so we dont have to send data outside the organization.
3. Plan to modularize the code. Deep dive for stale code, debug for failire, edge cases etc. Reduce file sizes.
4. We need to have the nav menu on the right properly structured. 
5. In the sketch. we need to have the option of repeat

11. We need to have the ability to move parts around in the folders and maybe also have a dialog to move to a different directory (like from archive to basic or to another one etc)
12. I see the r-weld-extrude is in stale but is it not used?


## Redesign Thought
Right now we are baking everything in the server. Would it be better to serve only the code load that and execute in the client? We could do this for both the manifold and the occt.
Since the server is creating a translater from the json to the script anyway, there is some protection in the graph to script logic that should be quick. 
But we will use the client horsepower to execute?



Screenshot 2026-06-16 at 5.59.08 AM.png (desktop)
Can we combine the PARAMS/PROPS in tabs ont he top.. will save space

https://www.scratchapixel.com/lessons/3d-basic-rendering/introduction-to-shading/shading-lights.html
https://www.scratchapixel.com/lessons/3d-basic-rendering/introduction-to-shading/shading-normals.html



PARKED. 
1. We need to build a parametric casing visualizaiton. Here basically we will have a function thst will determine
2. By default new revolve, extrude parts should use sketch not the polygon.
3. The autolayout is not working well. The params and the properties card should never overlap with any other card. We need to mae them repel all other cards.
4. Now for the move/rotate graph system can we impement a tighter bound connecter of mv rotate in a up don upp down manner the sockets for the top on the top (x y z) and the node sockets fo the bottom on the bottom. the little badges will attach to the part card making it more compact.
The mv and rot should be attached in a two row pattern 
    1 3
    2 4
    each strip should have the xyz sockets. These will be on top for the 1 and 3 and botom for the 2 and 4. http://localhost:3333/design. Need to make a proper graph of the architecture and navigatioj for this app. Use svelteflow.


